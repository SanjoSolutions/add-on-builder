import { exec } from '@sanjo/exec'
import { readFile } from '@sanjo/read-file'
import { retrieveDependencies, retrieveVersion, retrieveAddOnTOCFilePath, prependFilesToLoad, extractListedFiles, retrieveAddOnName, resolveDependencies } from '@sanjo/toc'
import * as child_process from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import { fileExists } from './unnamed/file/fileExists.js'

const LIBS_FOLDER = 'libs'

export async function build() {
  const addOnPath = process.cwd()
  const addOnName = retrieveAddOnName(addOnPath)
  const buildDirectory = '../../build/' + addOnName + '/'
  await fs.rm(buildDirectory, { recursive: true, force: true })
  await fs.mkdir(buildDirectory, { recursive: true })

  const addOnTocFilePath = `./${ addOnName }.toc`

  await copyAddOn('.', buildDirectory)

  await fs.mkdir(path.join(buildDirectory, LIBS_FOLDER), { recursive: true })

  const dependencies = await resolveDependencies(addOnPath)

  for (const [gameVersion, dependencies] of dependencies) {

  }

  const dependenciesToCopy = await retrieveDependencies(addOnTocFilePath)
  const dependenciesToCopySet = new Set(dependenciesToCopy)
  for (let index = 0; index < dependenciesToCopy.length; index++) {
    const dependency = dependenciesToCopy[index]
    const dependencyPath = `../${ dependency }`

    let dependencies2
    try {
      await copyAddOn(dependencyPath, path.join(buildDirectory, LIBS_FOLDER, dependency))
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

  function determineLoadOrder() {

  }

  const loadOrder = determineLoadOrder()

  let filesToLoad = []

  for (const addOnPath of loadOrder) {
    filesToLoad = filesToLoad.concat(await extractListedFiles(retrieveAddOnTOCFilePath(addOnPath)))
  }

  prependFilesToLoad(addOnTocFilePath, filesToLoad)

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
