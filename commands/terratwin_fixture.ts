import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import {
  FIXTURE_FILES,
  FIXTURE_PARQUET_DIR,
  writeTerraTwinFixture,
} from '#database/fixtures/terratwin_fixture'

/**
 * Writes synthetic TerraTwin Parquet files into data/processed/parquet/ so the
 * app runs locally before Hein's real files are available. The values are
 * fake terrain; never demo or commit them.
 *
 * Refuses to touch existing files, which may be Hein's real data, unless
 * --force is given.
 */
export default class TerratwinFixture extends BaseCommand {
  static commandName = 'terratwin:fixture'
  static description =
    'Write synthetic TerraTwin Parquet files to data/processed/parquet for local development'

  static options: CommandOptions = {
    startApp: false,
  }

  @flags.boolean({ description: 'Overwrite existing Parquet files (they may be real data)' })
  declare force: boolean

  async run() {
    const root = this.app.makePath()
    const existing: string[] = []
    for (const file of FIXTURE_FILES) {
      const relative = join(FIXTURE_PARQUET_DIR, file)
      if (await fileExists(join(root, relative))) {
        existing.push(relative)
      }
    }

    if (existing.length > 0 && !this.force) {
      this.logger.error(
        `Not overwriting existing files (they may be Hein's real data): ${existing.join(', ')}`
      )
      this.logger.info('Run again with --force to replace them with synthetic data.')
      this.exitCode = 1
      return
    }

    await writeTerraTwinFixture(root, root)
    this.logger.success(
      `Wrote synthetic data to ${FIXTURE_PARQUET_DIR}/ (${FIXTURE_FILES.length} files)`
    )
    this.logger.warning(
      'These values are fake terrain for local development. Do not commit or demo them.'
    )
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
