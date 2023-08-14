import { exec } from '@sanjo/exec'
import { readFile } from '@sanjo/read-file'
import { retrieveDependencies, retrieveVersion, retrieveAddOnName, prependFilesToLoad } from '@sanjo/toc'
import * as child_process from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import { fileExists } from './unnamed/file/fileExists.js'
import * as yaml from 'js-yaml'
import { simpleGit } from 'simple-git'
import * as os from 'node:os'
import { writeFile } from '@sanjo/write-file'
import { last } from '@sanjo/array'

export async function build() {
  const addOnPath = process.cwd()
  const addOnName = retrieveAddOnName(addOnPath)
  const buildDirectory = '../../build/' + addOnName + '/'
  await fs.rm(buildDirectory, { recursive: true, force: true })
  await fs.mkdir(buildDirectory, { recursive: true })

  const addOnTocFilePath = `./${ addOnName }.toc`

  const dependenciesToCopy = await retrieveDependencies(addOnTocFilePath)
  const dependenciesToCopySet = new Set(dependenciesToCopy)
  for (let index = 0; index < dependenciesToCopy.length; index++) {
    const dependency = dependenciesToCopy[index]
    const dependencyPath = `../${ dependency }`

    let dependencies2
    try {
      await copyAddOn(dependencyPath, path.join(buildDirectory, dependency))
      dependencies2 = await retrieveDependencies(`${ dependencyPath }/${ dependency }.toc`)

      for (const dependency2 of dependencies2) {
        if (!dependenciesToCopySet.has(dependency2)) {
          dependenciesToCopySet.add(dependency2)
          dependenciesToCopy.push(dependency2)
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`Dependency "${ dependency }" has not been found and therefore not been included in the bundle.`)
      } else {
        throw error
      }
    }
  }

  await copyAddOn('.', `${ buildDirectory }/${ addOnName }`)

  async function generateOutputFileName() {
    const version = await retrieveVersion(addOnTocFilePath)
    let outputFileName = addOnName
    if (version) {
      outputFileName += '_' + version.replaceAll('.', '_')
    }
    outputFileName += '.zip'
    return outputFileName
  }

  const outputFileName = await generateOutputFileName()

  if (await fileExists(path.join(buildDirectory, '..', outputFileName))) {
    console.error(`Output file "${ outputFileName }" already exists. If you intend to overwrite it, please delete the file manually before running the build script.`)
  } else {
    child_process.execSync(`7z a -tzip ../${ outputFileName } *`, {
      cwd: buildDirectory,
    })
  }
}

const filesAndFoldersToLeaveOut = new Set([
  '.idea', '.git', '.gitignore', '.gitmodules',
])

async function copyAddOn(addOnSourcePath, addOnDestinationPath) {
  await fs.cp(addOnSourcePath, addOnDestinationPath, {
    recursive: true,
    filter(source) {
      return !filesAndFoldersToLeaveOut.has(path.basename(source)) && !source.endsWith('.bat')
    },
  })
}

export async function createPackageMetaFile(addOnPath) {
  const addOnName = path.basename(addOnPath)

  let content = `package-as: ${ addOnName }
enable-nolib-creation: no
externals:  
`

  const dependencies = await retrieveAllDependencies(addOnPath)

  for (const dependency of dependencies) {
    const gitURL = await retrieveDependencyGitURL(dependency.dependencyPath)
    const version = await retrieveVersion(determineTOCFilePath(addOnPath))
    content += `  libs/${ dependency.dependency }:\n` +
      `    url: ${ gitURL }\n` +
      `    tag: ${ version }\n`
  }

  // TODO: Include dependencies also as required-dependencies? (for extra revenue sharing?)
}

function determineTOCFilePath(addOnPath) {
  const addOnName = path.basename(addOnPath)
  const addOnTocFilePath = `${ addOnPath }/${ addOnName }.toc`
  return addOnTocFilePath
}

async function retrieveAllDependencies(addOnPath) {
  const result = []

  const addOnTocFilePath = determineTOCFilePath(addOnPath)

  const dependenciesToCopy = await retrieveDependencies(addOnTocFilePath)
  const dependenciesToCopySet = new Set(dependenciesToCopy)
  for (let index = 0; index < dependenciesToCopy.length; index++) {
    const dependency = dependenciesToCopy[index]
    const dependencyPath = path.resolve(addOnPath, `../${ dependency }`)

    result.push({
      dependency,
      dependencyPath,
    })

    const dependencies2 = await retrieveDependencies(`${ dependencyPath }/${ dependency }.toc`)
    for (const dependency2 of dependencies2) {
      if (!dependenciesToCopySet.has(dependency2)) {
        dependenciesToCopySet.add(dependency2)
        dependenciesToCopy.push(dependency2)
      }
    }
  }

  return result
}

async function retrieveDependencyGitURL(dependencyPath) {
  const dotGitContent = await readFile(path.join(dependencyPath, '.git'))
  const gitDirRegExp = /gitdir: (.+)/
  const match = gitDirRegExp.exec(dotGitContent)
  const relativeGitModulePath = match[1]
  const gitModulePath = path.relative(dependencyPath, relativeGitModulePath)
  const remotes = await exec(
    'C:\\Program Files\\Git\\cmd\\git.exe remote -v',
    {
      cwd: gitModulePath,
    },
  )
  const gitURL = convertSSHToHTTPS(extractOriginFetch(remotes))
  return gitURL
}

function extractOriginFetch(remotes) {
  const lines = remotes.split('\n')
  const partsRegExp = /[^ ]+ +[^ ]+ +[^ ]+/
  for (const line of lines) {
    const match = partsRegExp.exec(line)
    if (match[1] === 'origin' && match[3] === '(fetch)') {
      return match[2]
    }
  }
  return null
}

function convertSSHToHTTPS(url) {
  const githubSSHURLRegExp = /^git@(github.com):(.+?\.git)$/
  const match = githubSSHURLRegExp.exec(url)
  if (match) {
    return `https://${ match[1] }/${ match[2] }`
  } else {
    return url
  }
}

export function buildWithPackageMetaFile() {

}

export async function updateDependencyIncludes(addOnPath) {
  let allDependencies = []

  let dependencies = await readDependenciesFromDotDependenciesFile(addOnPath)
  allDependencies = allDependencies.concat(dependencies)

  const librariesPath = path.join(addOnPath, 'libs')

  const git = simpleGit()
  while (dependencies.length >= 1) {
    const dependency = dependencies.shift()
    const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'add-on-builder-'))
    git.clone(dependency.url, directoryPath).checkout(dependency.tag)
    const dependencyDependencies = (await determineDependencies(directoryPath)).map(dependency => ({
      ...dependency,
      path: path.join(librariesPath, last(dependency.path.split('/')))
    }))
    dependencies = dependencies.concat(dependencyDependencies)
    allDependencies = allDependencies.concat(dependencyDependencies)
  }

  await updatePackageMetaFile(addOnPath, librariesPath, allDependencies)
  await updateTOCFiles(addOnPath, librariesPath, allDependencies)
}

async function readDependenciesFromDotDependenciesFile(addOnPath) {
  return yaml.load(await readFile(path.join(addOnPath, '.dependencies')))
}

async function determineDependencies(addOnPath) {
  return await determineDependenciesDeclaredInDotDependenciesFile(addOnPath)
}

async function determineDependenciesDeclaredInDotDependenciesFile(addOnPath) {
  return await readDependenciesFromDotDependenciesFile(addOnPath)
}

async function updatePackageMetaFile(addOnPath, librariesPath, dependencies) {
  // TODO: Also support the other name for package meta files (see CurseForge documentation
  const packageMetaDocument = yaml.load(await readFile(path.join(addOnPath, '.pkgmeta')))
  for (const dependency of dependencies) {
    packageMetaDocument.externals[dependency.path] = {
      url: dependency.url,
      tag: dependency.tag
    }
  }
  await writeFile(path.join(addOnPath, '.pkgmeta'), yaml.dump(packageMetaDocument))
}

async function updateTOCFiles(addOnPath, librariesPath, dependencies) {
  const addOnName = retrieveAddOnName(addOnPath)
  updateTOCFile(addOnPath, librariesPath, dependencies, path.join(addOnPath, addOnName + '.toc'))
  updateTOCFile(addOnPath, librariesPath, dependencies, path.join(addOnPath, addOnName + '_Wrath.toc'))
  updateTOCFile(addOnPath, librariesPath, dependencies, path.join(addOnPath, addOnName + '_Vanilla.toc'))
}

async function updateTOCFile(addOnPath, librariesPath, dependencies, tocFilePath) {
  await addLibraryIncludes(addOnPath, dependencies, tocFilePath)
}

async function addLibraryIncludes(addOnPath, dependencies, tocFilePath) {
  const includes = dependencies.map(dependency => path.relative(addOnPath, dependency.path))
  await addIncludesBeforeOtherIncludes(tocFilePath, includes)
}

async function addIncludesBeforeOtherIncludes(tocFilePath, includes) {
  await prependFilesToLoad(tocFilePath, includes)
}
