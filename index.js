import { retrieveDependencies, retrieveVersion } from '@sanjo/toc'
import * as child_process from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import { fileExists } from './unnamed/file/fileExists.js'

export async function build() {
  const addOnName = path.basename(process.cwd())
  const buildDirectory = '../../build/' + addOnName + '/'
  await fs.rm(buildDirectory, { recursive: true, force: true })
  await fs.mkdir(buildDirectory, { recursive: true })

  const addOnTocFilePath = `./${ addOnName }.toc`

  const dependenciesToCopy = await retrieveDependencies(addOnTocFilePath)
  const dependenciesToCopySet = new Set(dependenciesToCopy)
  for (let index = 0; index < dependenciesToCopy.length; index++) {
    const dependency = dependenciesToCopy[index]
    const dependencyPath = `../${ dependency }`
    await copyAddOn(dependencyPath, path.join(buildDirectory, dependency))

    const dependencies2 = await retrieveDependencies(`${ dependencyPath }/${ dependency }.toc`)
    for (const dependency2 of dependencies2) {
      if (!dependenciesToCopySet.has(dependency2)) {
        dependenciesToCopySet.add(dependency2)
        dependenciesToCopy.push(dependency2)
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
