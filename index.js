import { retrieveDependencies, retrieveVersion } from '@sanjo/toc'
import * as child_process from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import { fileExists } from './unnamed/file/fileExists.js'

export async function build() {
  const buildDirectory = 'build'
  await fs.rm(buildDirectory, { recursive: true, force: true })
  await fs.mkdir(buildDirectory, { recursive: true })

  const addOnName = path.basename(process.cwd())
  const addOnTocFilePath = `./${ addOnName }/${ addOnName }.toc`

  const dependenciesToCopy = await retrieveDependencies(addOnTocFilePath)
  const dependenciesToCopySet = new Set(dependenciesToCopy)
  for (let index = 0; index < dependenciesToCopy.length; index++) {
    const dependency = dependenciesToCopy[index]
    const dependencyPath = `AddOns/${ dependency }`
    await fs.cp(dependencyPath, path.join(buildDirectory, dependency), { recursive: true })

    const dependencies2 = await retrieveDependencies(`${ dependencyPath }/${ dependency }.toc`)
    for (const dependency2 of dependencies2) {
      if (!dependenciesToCopySet.has(dependency2)) {
        dependenciesToCopySet.add(dependency2)
        dependenciesToCopy.push(dependency2)
      }
    }
  }

  await fs.cp(addOnName, `${ buildDirectory }/${ addOnName }`, { recursive: true })
  await fs.cp('LICENSE', `${ buildDirectory }/${ addOnName }/LICENSE`)
  await fs.cp('README.md', `${ buildDirectory }/${ addOnName }/README.md`)

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

  if (await fileExists(outputFileName)) {
    console.error(`Output file "${ outputFileName }" already exists. If you intend to overwrite it, please delete the file manually before running the build script.`)
  } else {
    child_process.execSync(`7z a -tzip ../${ outputFileName } *`, {
      cwd: buildDirectory,
    })
  }
}
