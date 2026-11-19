const fsSync = require('fs');
const fs = require('fs/promises');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { legacyRatingToTagId, normalizeJournalTagIds } = require('../shared/journalTags');
const path = require('path');

const LEGACY_DATA_FILE_NAME = 'whbr-data.json';
const LEGACY_MONTHLY_DATA_FILE_REGEX = /^whbr-data-(\d{4}-\d{2})\.json$/;
const LEGACY_SETTINGS_FILE_NAME = 'whbr-settings.json';
const LEGACY_SETTINGS_LOCATION_FILE_NAME = 'whbr-settings-location.json';
const DATA_FILE_PREFIX = 'rizhi-data-';
const DATA_FILE_PATTERN = 'rizhi-data-YYYY-MM.json';
const DATA_FILE_REGEX = /^rizhi-data-(\d{4}-\d{2})\.json$/;
const SETTINGS_FILE_NAME = 'rizhi-settings.json';
const SETTINGS_LOCATION_FILE_NAME = 'rizhi-settings-location.json';
const MEDIA_MONTH_DIRECTORY_REGEX = /^\d{4}-\d{2}$/;

function createDefaultData() {
  return {
    version: 2,
    tasks: [],
    journals: [],
    profile: {},
    updatedAt: new Date().toISOString()
  };
}

function getDefaultDataPath(app) {
  return getMonthlyDataPath(getDefaultMemoryDir(app), monthKeyFromDate(new Date()));
}

function getDefaultSettingsPath(app) {
  return path.join(getDefaultMemoryDir(app), SETTINGS_FILE_NAME);
}

function getLegacyDefaultSettingsPath(app) {
  return path.join(getLegacyInstallMemoryDir(app), LEGACY_SETTINGS_FILE_NAME);
}

function getSettingsLocationPath(app) {
  return path.join(app.getPath('userData'), SETTINGS_LOCATION_FILE_NAME);
}

function getPreviousSettingsLocationPath(app) {
  return path.join(getDefaultMemoryDir(app), SETTINGS_LOCATION_FILE_NAME);
}

function getLegacySettingsLocationPath(app) {
  return path.join(getLegacyInstallMemoryDir(app), LEGACY_SETTINGS_LOCATION_FILE_NAME);
}

function getDefaultMemoryDir(app) {
  if (!app.isPackaged) return getLegacyInstallMemoryDir(app);
  // 安装目录：<选定位置>/rizhi/rizhi；数据目录：<选定位置>/rizhi/memory。
  return path.join(path.dirname(path.dirname(app.getPath('exe'))), 'memory');
}

function getLegacyInstallMemoryDir(app) {
  const appRoot = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.join(appRoot, 'memory');
}

function canUseDirectory(directoryPath) {
  try {
    fsSync.mkdirSync(directoryPath, { recursive: true });
    fsSync.accessSync(directoryPath, fsSync.constants.R_OK | fsSync.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

async function getDataDirectory(app) {
  await migrateStorageNames(app);
  const settings = await readSettings(app);
  if (settings.dataDirectory) return settings.dataDirectory;
  if (settings.dataFilePath) return path.dirname(settings.dataFilePath);
  return getDefaultMemoryDir(app);
}

async function getMediaDirectory(app, dataDirectory = '') {
  const settings = await readSettings(app);
  if (settings.mediaDirectory) return settings.mediaDirectory;
  // 媒体按月直接放入 memory/YYYY-MM/YYYY-MM-DD，和当月 JSON 在同一目录。
  return dataDirectory || await getDataDirectory(app);
}

async function getDataPath(app) {
  return getMonthlyDataPath(await getDataDirectory(app), monthKeyFromDate(new Date()));
}

function getMonthlyDataPath(dataDirectory, monthKey) {
  return path.join(dataDirectory, monthKey, `${DATA_FILE_PREFIX}${monthKey}.json`);
}

async function getActiveSettingsPath(app) {
  await migrateStorageNames(app);
  return getActiveSettingsPathWithoutMigration(app);
}

async function getActiveSettingsPathWithoutMigration(app) {
  const locationPaths = [
    getSettingsLocationPath(app),
    getPreviousSettingsLocationPath(app),
    getLegacySettingsLocationPath(app)
  ];
  for (const locationPath of locationPaths) {
    try {
      const text = await fs.readFile(locationPath, 'utf8');
      const location = JSON.parse(text);
      if (location.settingsFilePath && await fileExists(location.settingsFilePath)) return location.settingsFilePath;
    } catch (error) {}
  }
  if (await fileExists(getDefaultSettingsPath(app))) return getDefaultSettingsPath(app);
  if (await fileExists(getLegacyDefaultSettingsPath(app))) return getLegacyDefaultSettingsPath(app);
  return getDefaultSettingsPath(app);
}

async function readSettings(app) {
  const settingsPath = await getActiveSettingsPath(app);

  try {
    const text = await fs.readFile(settingsPath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    return {};
  }
}

async function writeSettings(app, settings) {
  const settingsPath = await getActiveSettingsPath(app);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return settingsPath;
}

async function loadData(app) {
  await migrateStorageNames(app);
  const dataDirectory = await getDataDirectory(app);
  const mediaDirectory = await getMediaDirectory(app, dataDirectory);
  const settingsFilePath = await getActiveSettingsPath(app);
  const settings = await readSettings(app);
  const monthlyFiles = await listMonthlyDataFiles(dataDirectory);
  const monthlyData = await readMonthlyDataFiles(monthlyFiles);
  const legacyData = await readLegacyData(dataDirectory);
  const data = normalizeData({
    ...createDefaultData(),
    tasks: dedupeById([...legacyData.tasks, ...monthlyData.tasks]),
    journals: dedupeById([...legacyData.journals, ...monthlyData.journals]),
    profile: {
      ...(legacyData.profile || {}),
      ...(monthlyData.profile || {}),
      ...(settings.profile || {})
    },
    updatedAt: monthlyData.updatedAt || legacyData.updatedAt || new Date().toISOString()
  });

  return {
    data,
    paths: buildPaths(app, dataDirectory, settingsFilePath, monthlyFiles, mediaDirectory),
    status: monthlyFiles.length > 0 || legacyData.hasData ? 'ok' : 'empty'
  };
}

async function saveData(app, data) {
  await migrateStorageNames(app);
  const dataDirectory = await getDataDirectory(app);
  const mediaDirectory = await getMediaDirectory(app, dataDirectory);
  const settingsFilePath = await getActiveSettingsPath(app);
  const normalized = normalizeData(data);
  const updatedAt = new Date().toISOString();
  normalized.updatedAt = updatedAt;

  await fs.mkdir(dataDirectory, { recursive: true });
  await saveProfileToSettings(app, normalized.profile);
  await writeMonthlyDataFiles(dataDirectory, normalized, updatedAt);

  const monthlyFiles = await listMonthlyDataFiles(dataDirectory);
  return {
    data: normalized,
    paths: buildPaths(app, dataDirectory, settingsFilePath, monthlyFiles, mediaDirectory),
    status: 'ok'
  };
}

async function setStorageDirectory(app, dataDirectory, currentData) {
  await migrateStorageNames(app);
  const oldPaths = await getStoragePaths(app);
  const targetDirectory = path.resolve(dataDirectory);
  if (samePath(oldPaths.dataDirectory, targetDirectory)) {
    const result = await loadData(app);
    return {
      ...result,
      migration: { from: oldPaths.dataDirectory, to: targetDirectory, skipped: true, deleted: [], cleanupWarnings: [] }
    };
  }

  const settings = await readSettings(app);
  const sourceData = normalizeData(currentData || (await loadData(app)).data);
  const settingsFilePath = path.join(targetDirectory, SETTINGS_FILE_NAME);
  const locationPath = getSettingsLocationPath(app);
  const oldDefaultMediaDirectory = oldPaths.dataDirectory;
  const migrateDefaultMedia = samePath(oldPaths.mediaDirectory, oldDefaultMediaDirectory);
  const targetMediaDirectory = migrateDefaultMedia
    ? targetDirectory
    : oldPaths.mediaDirectory;
  const migratedData = migrateDefaultMedia
    ? rewriteMediaRoots(sourceData, oldPaths.mediaDirectory, targetMediaDirectory)
    : sourceData;
  const nextSettings = {
    ...settings,
    dataDirectory: targetDirectory,
    dataFilePath: undefined,
    settingsFilePath,
    profile: migratedData.profile
  };
  if (migrateDefaultMedia && settings.mediaDirectory) nextSettings.mediaDirectory = targetMediaDirectory;
  else if (migrateDefaultMedia) delete nextSettings.mediaDirectory;

  await fs.mkdir(targetDirectory, { recursive: true });
  const migratedMediaEntries = migrateDefaultMedia
    ? await copyManagedMediaEntries(oldPaths.mediaDirectory, targetMediaDirectory)
    : [];
  await writeMonthlyDataFiles(targetDirectory, migratedData, new Date().toISOString());
  await fs.writeFile(settingsFilePath, JSON.stringify(nextSettings, null, 2), 'utf8');
  await validateStorageTarget(targetDirectory, settingsFilePath);
  await fs.mkdir(path.dirname(locationPath), { recursive: true });
  await fs.writeFile(locationPath, JSON.stringify({ settingsFilePath }, null, 2), 'utf8');
  const result = await loadData(app);
  const cleanup = await cleanupOldStorage(oldPaths, {
    nextSettingsFilePath: settingsFilePath,
    migratedMediaEntries
  });
  return {
    ...result,
    migration: {
      from: oldPaths.dataDirectory,
      to: targetDirectory,
      mediaMigrated: migrateDefaultMedia,
      ...cleanup
    }
  };
}

async function setMediaDirectory(app, mediaDirectory, currentData) {
  await migrateStorageNames(app);
  const oldPaths = await getStoragePaths(app);
  const targetDirectory = path.resolve(mediaDirectory);
  if (samePath(oldPaths.mediaDirectory, targetDirectory)) {
    return {
      data: normalizeData(currentData || (await loadData(app)).data),
      paths: oldPaths,
      migration: { from: oldPaths.mediaDirectory, to: targetDirectory, skipped: true, deleted: [], cleanupWarnings: [] }
    };
  }

  const settings = await readSettings(app);
  const sourceData = normalizeData(currentData || (await loadData(app)).data);
  const migratedData = rewriteMediaRoots(sourceData, oldPaths.mediaDirectory, targetDirectory);
  await fs.mkdir(targetDirectory, { recursive: true });
  const migratedMediaEntries = await copyManagedMediaEntries(oldPaths.mediaDirectory, targetDirectory);

  try {
    await writeSettings(app, { ...settings, mediaDirectory: targetDirectory });
    const result = await saveData(app, migratedData);
    const cleanup = await cleanupManagedMediaEntries(oldPaths.mediaDirectory, migratedMediaEntries);
    return {
      ...result,
      migration: {
        from: oldPaths.mediaDirectory,
        to: targetDirectory,
        mediaMigrated: true,
        ...cleanup
      }
    };
  } catch (error) {
    await writeSettings(app, settings).catch(() => {});
    throw error;
  }
}

async function previewStorageRoot(app, storageRoot, currentData) {
  await migrateStorageNames(app);
  const oldPaths = await getStoragePaths(app);
  const targetRoot = path.resolve(storageRoot);
  if (samePath(oldPaths.dataDirectory, targetRoot)) {
    return { from: oldPaths.dataDirectory, to: targetRoot, skipped: true, added: { tasks: 0, journals: 0, files: 0 }, conflicts: [] };
  }
  assertNonNestedMigrationPaths(oldPaths.dataDirectory, targetRoot);
  const sourceData = normalizeData(currentData || (await loadData(app)).data);
  const target = await readStorageDirectoryStrict(targetRoot);
  const conflicts = [];
  if (target.settings.mediaDirectory && !samePath(target.settings.mediaDirectory, targetRoot)) {
    conflicts.push(`目标设置使用独立媒体目录 ${target.settings.mediaDirectory}，迁移后继续保留该路径`);
  }
  const files = await scanStorageFiles(oldPaths.dataDirectory, targetRoot);
  if (!samePath(oldPaths.mediaDirectory, oldPaths.dataDirectory)) {
    const media = await scanStorageFiles(oldPaths.mediaDirectory, targetRoot, { mediaOnly: true });
    files.added.push(...media.added);
    conflicts.push(...media.conflicts);
    Object.assign(files.renamed, media.renamed);
  }
  const merged = mergeStorageData(
    rewriteMediaRoots(sourceData, oldPaths.mediaDirectory, targetRoot, files.renamed),
    target.data,
    conflicts
  );
  mergeMissingValues(migrationSettings(target.settings), migrationSettings(await readSettings(app)), '设置', conflicts);
  conflicts.push(...files.conflicts);
  return {
    from: oldPaths.dataDirectory,
    to: targetRoot,
    skipped: false,
    added: { tasks: merged.added.tasks, journals: merged.added.journals, files: files.added.length },
    conflicts: [...new Set(conflicts)]
  };
}

async function setStorageRoot(app, storageRoot, currentData) {
  const preview = await previewStorageRoot(app, storageRoot, currentData);
  if (preview.skipped) return { ...(await loadData(app)), migration: { ...preview, deleted: [], cleanupWarnings: [] } };
  const oldPaths = await getStoragePaths(app);
  const targetRoot = preview.to;
  const sourceData = normalizeData(currentData || (await loadData(app)).data);
  const target = await readStorageDirectoryStrict(targetRoot);
  const files = await scanStorageFiles(oldPaths.dataDirectory, targetRoot);
  if (!samePath(oldPaths.mediaDirectory, oldPaths.dataDirectory)) {
    const media = await scanStorageFiles(oldPaths.mediaDirectory, targetRoot, { mediaOnly: true });
    Object.assign(files.renamed, media.renamed);
  }
  const conflicts = [];
  if (target.settings.mediaDirectory && !samePath(target.settings.mediaDirectory, targetRoot)) {
    conflicts.push(`目标设置使用独立媒体目录 ${target.settings.mediaDirectory}，迁移后继续保留该路径`);
  }
  const merged = mergeStorageData(
    rewriteMediaRoots(sourceData, oldPaths.mediaDirectory, targetRoot, files.renamed),
    target.data,
    conflicts
  );
  const sourceSettings = await readSettings(app);
  const nextSettings = mergeMissingValues(migrationSettings(target.settings), migrationSettings(sourceSettings), '设置', conflicts);
  nextSettings.profile = merged.data.profile;
  nextSettings.dataDirectory = targetRoot;
  nextSettings.dataFilePath = undefined;
  nextSettings.settingsFilePath = path.join(targetRoot, SETTINGS_FILE_NAME);
  if (target.settings.mediaDirectory && !samePath(target.settings.mediaDirectory, targetRoot)) {
    nextSettings.mediaDirectory = target.settings.mediaDirectory;
  } else {
    delete nextSettings.mediaDirectory;
  }

  await fs.mkdir(targetRoot, { recursive: true });
  const copied = await copyStorageFilesWithoutOverwrite(oldPaths.dataDirectory, targetRoot);
  if (!samePath(oldPaths.mediaDirectory, oldPaths.dataDirectory)) {
    const mediaCopied = await copyStorageFilesWithoutOverwrite(oldPaths.mediaDirectory, targetRoot, { mediaOnly: true });
    copied.added.push(...mediaCopied.added);
    conflicts.push(...mediaCopied.conflicts);
    Object.assign(copied.renamed, mediaCopied.renamed);
  }
  conflicts.push(...copied.conflicts);
  if (!isDeepStrictEqual(copied.renamed, files.renamed)) {
    throw new Error('目标文件在预览后发生变化，迁移已停止，请重新选择。');
  }
  const latestTarget = await readStorageDirectoryStrict(targetRoot);
  if (!isDeepStrictEqual(latestTarget.data, target.data)
    || !isDeepStrictEqual(latestTarget.settings, target.settings)) {
    throw new Error('目标数据在迁移过程中发生变化，迁移已停止，请重新选择。');
  }
  await writeMonthlyDataFiles(targetRoot, merged.data, new Date().toISOString(), { preserveExistingMonths: true });
  const settingsFilePath = path.join(targetRoot, SETTINGS_FILE_NAME);
  await backupExistingFile(settingsFilePath);
  await writeJsonAtomically(settingsFilePath, nextSettings);
  await validateStorageTarget(targetRoot, settingsFilePath);
  const locationPath = getSettingsLocationPath(app);
  await fs.mkdir(path.dirname(locationPath), { recursive: true });
  await writeJsonAtomically(locationPath, { settingsFilePath });
  const result = await loadData(app);
  return {
    ...result,
    migration: {
      from: oldPaths.dataDirectory,
      to: targetRoot,
      added: { tasks: merged.added.tasks, journals: merged.added.journals, files: copied.added.length },
      conflicts: [...new Set(conflicts)],
      deleted: [],
      cleanupWarnings: []
    }
  };
}

async function readStorageDirectoryStrict(directory) {
  const settingsPath = path.join(directory, SETTINGS_FILE_NAME);
  const settings = await readOptionalJsonStrict(settingsPath) || {};
  const legacy = await readOptionalJsonStrict(path.join(directory, LEGACY_DATA_FILE_NAME));
  const monthlyFiles = await listMonthlyDataFiles(directory);
  const shards = await Promise.all(monthlyFiles.map((filePath) => readOptionalJsonStrict(filePath)));
  const combined = createDefaultData();
  combined.updatedAt = '';
  for (const shard of [legacy, ...shards]) {
    if (!shard) continue;
    if ((shard.tasks !== undefined && !Array.isArray(shard.tasks))
      || (shard.journals !== undefined && !Array.isArray(shard.journals))) {
      throw new Error('目标目录的数据格式无效，迁移已停止。');
    }
    combined.tasks.push(...(shard.tasks || []));
    combined.journals.push(...(shard.journals || []));
    combined.profile = { ...combined.profile, ...(shard.profile || {}) };
    if (shard.updatedAt) combined.updatedAt = shard.updatedAt;
  }
  combined.profile = { ...combined.profile, ...(settings.profile || {}) };
  combined.tasks = dedupeById(combined.tasks);
  combined.journals = dedupeById(combined.journals);
  return { data: combined, settings };
}

function migrationSettings(settings) {
  const { dataDirectory, dataFilePath, settingsFilePath, mediaDirectory, ...content } = settings || {};
  return content;
}

async function readOptionalJsonStrict(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`无法读取目标数据文件 ${filePath}：${error.message}`);
  }
}

function mergeStorageData(source, target, conflicts) {
  const tasks = mergeRecordList(target.tasks, source.tasks, '任务', conflicts);
  const journals = mergeRecordList(target.journals, source.journals, '记录', conflicts);
  return {
    data: {
      ...target,
      version: Math.max(target.version, source.version),
      tasks: tasks.items,
      journals: journals.items,
      profile: mergeMissingValues(target.profile, source.profile, '设置', conflicts)
    },
    added: { tasks: tasks.added, journals: journals.added }
  };
}

function mergeRecordList(targetItems, sourceItems, label, conflicts) {
  const items = [...targetItems];
  const existing = new Map(targetItems.map((item) => [item && item.id ? item.id : JSON.stringify(item), item]));
  let added = 0;
  for (const item of sourceItems) {
    const key = item && item.id ? item.id : JSON.stringify(item);
    if (!existing.has(key)) {
      items.push(item);
      existing.set(key, item);
      added += 1;
    } else if (!isDeepStrictEqual(existing.get(key), item)) {
      conflicts.push(`${label} ID ${key}`);
    }
  }
  return { items, added };
}

function mergeMissingValues(target, source, label, conflicts) {
  if (target === undefined) return structuredClone(source);
  if (source === undefined) return target;
  if (isDeepStrictEqual(target, source)) return target;
  if (Array.isArray(target) && Array.isArray(source)) {
    if (target.length === 0) return structuredClone(source);
    if (source.length === 0) return target;
    if (target.every((item) => item && typeof item === 'object' && item.id)
      && source.every((item) => item && typeof item === 'object' && item.id)) {
      return mergeRecordList(target, source, label, conflicts).items;
    }
    conflicts.push(label);
    return target;
  }
  if (target && source && typeof target === 'object' && typeof source === 'object'
    && !Array.isArray(target) && !Array.isArray(source)) {
    const merged = { ...target };
    for (const [key, value] of Object.entries(source)) {
      merged[key] = mergeMissingValues(target[key], value, `${label}.${key}`, conflicts);
    }
    return merged;
  }
  conflicts.push(label);
  return target;
}

async function scanStorageFiles(sourceRoot, targetRoot, options = {}) {
  return walkStorageFiles(sourceRoot, targetRoot, options, false);
}

async function copyStorageFilesWithoutOverwrite(sourceRoot, targetRoot, options = {}) {
  return walkStorageFiles(sourceRoot, targetRoot, options, true);
}

async function walkStorageFiles(sourceRoot, targetRoot, options, copy) {
  const added = [];
  const conflicts = [];
  const renamed = {};
  if (!(await fileExists(sourceRoot))) return { added, conflicts, renamed };
  assertNonNestedMigrationPaths(sourceRoot, targetRoot);
  async function visit(relative = '') {
    const source = path.join(sourceRoot, relative);
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (!relative && (entry.name === 'models' || entry.name === '.upload-staging')) continue;
      if (!relative && options.mediaOnly && !MEDIA_MONTH_DIRECTORY_REGEX.test(entry.name)) continue;
      if (entry.name === SETTINGS_FILE_NAME || entry.name === LEGACY_SETTINGS_FILE_NAME
        || entry.name === LEGACY_DATA_FILE_NAME || DATA_FILE_REGEX.test(entry.name)) continue;
      const nextRelative = path.join(relative, entry.name);
      const from = path.join(sourceRoot, nextRelative);
      const to = path.join(targetRoot, nextRelative);
      const sourceInsideDestination = path.relative(to, sourceRoot);
      if (!sourceInsideDestination || (sourceInsideDestination !== '..'
        && !sourceInsideDestination.startsWith(`..${path.sep}`)
        && !path.isAbsolute(sourceInsideDestination))) {
        throw new Error(`目标子目录 ${to} 包含原数据目录，无法安全合并。`);
      }
      const targetStat = await statIfExists(to);
      if (entry.isDirectory()) {
        if (targetStat && !targetStat.isDirectory()) {
          throw new Error(`目标位置的 ${nextRelative} 是文件，无法合并目录。`);
        }
        if (copy) await fs.mkdir(to, { recursive: true });
        await visit(nextRelative);
      } else if (entry.isFile()) {
        if (targetStat) {
          if (!targetStat.isFile()) throw new Error(`目标位置的 ${nextRelative} 是目录，无法合并文件。`);
          if (!(await sameFileContent(from, to))) {
            const digest = await fileDigest(from);
            const alternate = path.join(path.dirname(nextRelative), `${path.parse(nextRelative).name}.source-${digest.slice(0, 16)}${path.extname(nextRelative)}`);
            const alternatePath = path.join(targetRoot, alternate);
            const alternateStat = await statIfExists(alternatePath);
            if (alternateStat && (!alternateStat.isFile() || !(await sameFileContent(from, alternatePath)))) {
              throw new Error(`冲突副本 ${alternate} 已存在且内容不同，迁移已停止。`);
            }
            renamed[nextRelative.replace(/\\/g, '/')] = alternate.replace(/\\/g, '/');
            conflicts.push(`文件 ${nextRelative} 不同，来源另存为 ${alternate}`);
            if (!alternateStat) {
              added.push(alternate);
              if (copy) {
                await fs.mkdir(path.dirname(alternatePath), { recursive: true });
                await fs.copyFile(from, alternatePath, fsSync.constants.COPYFILE_EXCL);
              }
            }
          }
        } else {
          added.push(nextRelative);
          if (copy) {
            await fs.mkdir(path.dirname(to), { recursive: true });
            await fs.copyFile(from, to, fsSync.constants.COPYFILE_EXCL);
          }
        }
      } else {
        throw new Error(`原目录包含不支持迁移的特殊文件 ${nextRelative}。`);
      }
    }
  }
  await visit();
  return { added, conflicts, renamed };
}

async function sameFileContent(first, second) {
  const [firstStat, secondStat] = await Promise.all([fs.stat(first), fs.stat(second)]);
  if (firstStat.size !== secondStat.size) return false;
  const [firstHash, secondHash] = await Promise.all([fileDigest(first), fileDigest(second)]);
  return firstHash === secondHash;
}

function fileDigest(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath);
    const digest = crypto.createHash('sha256');
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

async function backupExistingFile(filePath) {
  if (!(await fileExists(filePath))) return;
  await fs.copyFile(filePath, `${filePath}.before-migration-${crypto.randomUUID()}.bak`, fsSync.constants.COPYFILE_EXCL);
}

async function writeJsonAtomically(filePath, value) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function moveRemainingDirectoryContents(sourceRoot, targetRoot) {
  const deleted = [];
  const cleanupWarnings = [];
  if (samePath(sourceRoot, targetRoot) || !(await fileExists(sourceRoot))) return { deleted, cleanupWarnings };

  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  await fs.mkdir(targetRoot, { recursive: true });
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    try {
      await moveEntryPreservingStructure(source, target);
      deleted.push(source);
    } catch (error) {
      cleanupWarnings.push(`${source}：${error.message || String(error)}`);
    }
  }
  await attemptCleanup(() => removeDirectoryIfEmpty(sourceRoot, deleted), cleanupWarnings);
  return { deleted, cleanupWarnings };
}

async function moveEntryPreservingStructure(source, target) {
  const sourceStat = await fs.lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error('不迁移符号链接');
  const targetStat = await statIfExists(target);

  if (sourceStat.isDirectory()) {
    if (targetStat && !targetStat.isDirectory()) throw new Error('目标位置存在同名文件');
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      await moveEntryPreservingStructure(path.join(source, entry.name), path.join(target, entry.name));
    }
    await fs.rmdir(source);
    return;
  }

  if (!sourceStat.isFile()) throw new Error('不迁移特殊文件');
  if (targetStat) throw new Error('目标位置存在同名内容');
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(source, target, fsSync.constants.COPYFILE_EXCL);
    await fs.unlink(source);
  }
}

async function statIfExists(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function rewriteMediaRoots(data, oldRoot, newRoot, renamed = {}) {
  const normalized = normalizeData(data);
  return {
    ...normalized,
    journals: normalized.journals.map((journal) => ({
      ...journal,
      media: Array.isArray(journal.media)
        ? journal.media.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const itemRoot = item.mediaRoot ? path.resolve(item.mediaRoot) : path.resolve(oldRoot);
          if (!samePath(itemRoot, oldRoot)) return item;
          const updated = { ...item, mediaRoot: path.resolve(newRoot) };
          for (const field of ['sourcePath', 'previewPath', 'thumbnailPath', 'motionSourcePath', 'motionPreviewPath']) {
            const relative = typeof updated[field] === 'string' ? updated[field].replace(/\\/g, '/') : '';
            if (renamed[relative]) updated[field] = renamed[relative];
          }
          return updated;
        })
        : journal.media
    }))
  };
}

async function copyManagedMediaEntries(sourceRoot, targetRoot) {
  if (samePath(sourceRoot, targetRoot) || !(await fileExists(sourceRoot))) return [];
  assertNonNestedMigrationPaths(sourceRoot, targetRoot);
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  const managedEntries = entries.filter((entry) => entry.isDirectory() && MEDIA_MONTH_DIRECTORY_REGEX.test(entry.name));
  await fs.mkdir(targetRoot, { recursive: true });
  for (const entry of managedEntries) {
    await fs.cp(path.join(sourceRoot, entry.name), path.join(targetRoot, entry.name), {
      recursive: true,
      force: true
    });
  }
  return managedEntries.map((entry) => entry.name);
}

function assertNonNestedMigrationPaths(sourceRoot, targetRoot) {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  const targetInsideSource = path.relative(source, target);
  if (!targetInsideSource || (targetInsideSource !== '..'
    && !targetInsideSource.startsWith(`..${path.sep}`)
    && !path.isAbsolute(targetInsideSource))) {
    throw new Error('新位置不能位于原数据目录内部。');
  }
}

async function validateStorageTarget(dataDirectory, settingsFilePath) {
  JSON.parse(await fs.readFile(settingsFilePath, 'utf8'));
  const monthlyFiles = await listMonthlyDataFiles(dataDirectory);
  for (const filePath of monthlyFiles) JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function cleanupOldStorage(oldPaths, options = {}) {
  const deleted = [];
  const cleanupWarnings = [];
  await attemptCleanup(() => removeMonthlyDataFiles(oldPaths.dataDirectory, deleted), cleanupWarnings);
  await attemptCleanup(() => removeFileIfExists(path.join(oldPaths.dataDirectory, LEGACY_DATA_FILE_NAME), deleted), cleanupWarnings);
  await attemptCleanup(() => removeFileIfExists(path.join(oldPaths.dataDirectory, LEGACY_SETTINGS_FILE_NAME), deleted), cleanupWarnings);
  if (!samePath(oldPaths.settingsFilePath, options.nextSettingsFilePath)) {
    await attemptCleanup(() => removeFileIfExists(oldPaths.settingsFilePath, deleted), cleanupWarnings);
  }
  if (options.migratedMediaEntries && options.migratedMediaEntries.length > 0) {
    const mediaCleanup = await cleanupManagedMediaEntries(oldPaths.mediaDirectory, options.migratedMediaEntries);
    deleted.push(...mediaCleanup.deleted);
    cleanupWarnings.push(...mediaCleanup.cleanupWarnings);
  }
  await attemptCleanup(() => removeDirectoryIfEmpty(oldPaths.mediaDirectory, deleted), cleanupWarnings);
  await attemptCleanup(() => removeDirectoryIfEmpty(oldPaths.dataDirectory, deleted), cleanupWarnings);
  return { deleted, cleanupWarnings };
}

async function cleanupManagedMediaEntries(sourceRoot, entryNames) {
  const deleted = [];
  const cleanupWarnings = [];
  for (const entryName of entryNames) {
    await attemptCleanup(
      () => removeDirectoryIfExists(path.join(sourceRoot, entryName), deleted),
      cleanupWarnings
    );
  }
  await attemptCleanup(() => removeDirectoryIfEmpty(sourceRoot, deleted), cleanupWarnings);
  return { deleted, cleanupWarnings };
}

async function attemptCleanup(action, warnings) {
  try {
    await action();
  } catch (error) {
    warnings.push(error.message || String(error));
  }
}

async function removeDirectoryIfEmpty(directoryPath, deleted) {
  try {
    await fs.rmdir(directoryPath);
    deleted.push(directoryPath);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

function samePath(firstPath, secondPath) {
  const normalizeForComparison = (value) => {
    const resolved = path.normalize(path.resolve(value || ''));
    return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
  };
  return normalizeForComparison(firstPath) === normalizeForComparison(secondPath);
}

async function resetData(app, data = createDefaultData(), options = {}) {
  await migrateStorageNames(app);
  const dataDirectory = await getDataDirectory(app);
  const mediaDirectory = await getMediaDirectory(app, dataDirectory);
  const deleted = [];
  const clearMedia = Boolean(options && options.clearMedia);
  const normalized = normalizeData(data);

  await removeMonthlyDataFiles(dataDirectory, deleted);
  await removeFileIfExists(path.join(dataDirectory, LEGACY_DATA_FILE_NAME), deleted);
  if (clearMedia && !samePath(mediaDirectory, dataDirectory)) {
    await removeDirectoryIfExists(mediaDirectory, deleted);
  }
  await removeDirectoryIfExists(path.join(dataDirectory, '.upload-staging'), deleted);
  const result = await saveData(app, normalized);

  return {
    ...result,
    deleted,
    status: 'reset'
  };
}

async function getStoragePaths(app) {
  await migrateStorageNames(app);
  const dataDirectory = await getDataDirectory(app);
  const mediaDirectory = await getMediaDirectory(app, dataDirectory);
  const settingsFilePath = await getActiveSettingsPath(app);
  const monthlyFiles = await listMonthlyDataFiles(dataDirectory);
  return buildPaths(app, dataDirectory, settingsFilePath, monthlyFiles, mediaDirectory);
}

function buildPaths(app, dataDirectory, settingsFilePath, monthlyFiles = [], mediaDirectory = dataDirectory) {
  const currentMonth = monthKeyFromDate(new Date());
  return {
    storageRoot: dataDirectory,
    dataDirectory,
    mediaDirectory,
    dataFilePath: getMonthlyDataPath(dataDirectory, currentMonth),
    dataFilePattern: path.join(dataDirectory, 'YYYY-MM', DATA_FILE_PATTERN),
    monthlyDataFiles: monthlyFiles,
    settingsFilePath,
    settingsLocationPath: getSettingsLocationPath(app),
    defaultMemoryDir: getDefaultMemoryDir(app),
    legacyStorageKeys: ['whbr.tasks', 'whbr.journals']
  };
}

async function listMonthlyDataFiles(dataDirectory) {
  try {
    const entries = await fs.readdir(dataDirectory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
      .map((entry) => path.join(dataDirectory, entry.name, `${DATA_FILE_PREFIX}${entry.name}.json`));
    // 兼容早期扁平结构；下一次迁移会将其移入对应月份目录。
    entries
      .filter((entry) => entry.isFile() && DATA_FILE_REGEX.test(entry.name))
      .forEach((entry) => files.push(path.join(dataDirectory, entry.name)));
    return (await Promise.all(files.map(async (filePath) => (await fileExists(filePath)) ? filePath : null)))
      .filter(Boolean)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

let storageMigrationPromise = null;

async function migrateStorageNames(app) {
  if (!storageMigrationPromise) {
    storageMigrationPromise = migrateStorageNamesOnce(app).catch((error) => {
      storageMigrationPromise = null;
      throw error;
    });
  }

  return storageMigrationPromise;
}

async function migrateStorageNamesOnce(app) {
  const defaultMemoryDir = getDefaultMemoryDir(app);
  const legacyInstallMemoryDir = getLegacyInstallMemoryDir(app);
  const oldDefaultSettingsPath = getLegacyDefaultSettingsPath(app);
  const newDefaultSettingsPath = getDefaultSettingsPath(app);
  const previousLocationPath = getPreviousSettingsLocationPath(app);
  const oldLocationPath = getLegacySettingsLocationPath(app);
  const newLocationPath = getSettingsLocationPath(app);

  await migrateDefaultMemoryFiles(legacyInstallMemoryDir, defaultMemoryDir);
  await renameFileIfNeeded(oldDefaultSettingsPath, newDefaultSettingsPath);

  let activeSettingsPath = await getActiveSettingsPathWithoutMigration(app);
  if (isLegacyDefaultSettingsPath(activeSettingsPath, legacyInstallMemoryDir) || (!(await fileExists(activeSettingsPath)) && (await fileExists(newDefaultSettingsPath)))) {
    activeSettingsPath = newDefaultSettingsPath;
  }
  if (path.basename(activeSettingsPath) === LEGACY_SETTINGS_FILE_NAME) {
    const renamedSettingsPath = path.join(path.dirname(activeSettingsPath), SETTINGS_FILE_NAME);
    await renameFileIfNeeded(activeSettingsPath, renamedSettingsPath);
    activeSettingsPath = renamedSettingsPath;
  }

  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(activeSettingsPath, 'utf8'));
  } catch (error) {
    settings = {};
  }

  if (settings.settingsFilePath && path.basename(settings.settingsFilePath) === LEGACY_SETTINGS_FILE_NAME) {
    const renamedSettingsPath = path.join(path.dirname(settings.settingsFilePath), SETTINGS_FILE_NAME);
    await renameFileIfNeeded(settings.settingsFilePath, renamedSettingsPath);
    settings.settingsFilePath = renamedSettingsPath;
    activeSettingsPath = renamedSettingsPath;
  }
  if (settings.settingsFilePath && isLegacyDefaultSettingsPath(settings.settingsFilePath, legacyInstallMemoryDir)) {
    settings.settingsFilePath = newDefaultSettingsPath;
    activeSettingsPath = newDefaultSettingsPath;
  }

  const dataDirectory = settings.dataDirectory || (settings.dataFilePath ? path.dirname(settings.dataFilePath) : defaultMemoryDir);
  if (settings.dataFilePath) {
    settings.dataFilePath = undefined;
  }

  // 已有版本的附件在 memory/images 中。保留该根目录的显式设置，确保
  // 升级后旧照片和视频仍可读取；新建存储则直接采用按月目录结构。
  let settingsChanged = Boolean(settings.settingsFilePath || settings.dataDirectory);
  if (!settings.mediaDirectory && await fileExists(path.join(dataDirectory, 'images'))) {
    settings.mediaDirectory = path.join(dataDirectory, 'images');
    settingsChanged = true;
  }

  if (settingsChanged) {
    await writeJsonFileIfChanged(activeSettingsPath, settings);
  }

  await fs.mkdir(defaultMemoryDir, { recursive: true });
  await writeJsonFileIfChanged(newLocationPath, { settingsFilePath: activeSettingsPath });
  if (!samePath(previousLocationPath, newLocationPath)) await removeFileIfExists(previousLocationPath, []);
  await removeFileIfExists(oldLocationPath, []);
  await renameLegacyMonthlyDataFiles(dataDirectory);
  await moveMonthlyDataFilesIntoMonthDirectories(dataDirectory);
}

async function migrateDefaultMemoryFiles(oldMemoryDir, newMemoryDir) {
  if (oldMemoryDir === newMemoryDir) return;

  await moveFileIfNeeded(
    path.join(oldMemoryDir, LEGACY_SETTINGS_FILE_NAME),
    path.join(newMemoryDir, SETTINGS_FILE_NAME)
  );
  await moveFileIfNeeded(
    path.join(oldMemoryDir, SETTINGS_FILE_NAME),
    path.join(newMemoryDir, SETTINGS_FILE_NAME)
  );
  await moveFileIfNeeded(
    path.join(oldMemoryDir, LEGACY_DATA_FILE_NAME),
    path.join(newMemoryDir, LEGACY_DATA_FILE_NAME)
  );

  try {
    const entries = await fs.readdir(oldMemoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const legacyMonthlyMatch = entry.name.match(LEGACY_MONTHLY_DATA_FILE_REGEX);
      if (legacyMonthlyMatch) {
        await moveFileIfNeeded(
          path.join(oldMemoryDir, entry.name),
          path.join(newMemoryDir, `${DATA_FILE_PREFIX}${legacyMonthlyMatch[1]}.json`)
        );
        continue;
      }

      if (DATA_FILE_REGEX.test(entry.name)) {
        await moveFileIfNeeded(path.join(oldMemoryDir, entry.name), path.join(newMemoryDir, entry.name));
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function isLegacyDefaultSettingsPath(settingsPath, legacyMemoryDir) {
  const normalized = path.normalize(settingsPath || '');
  return normalized === path.normalize(path.join(legacyMemoryDir, LEGACY_SETTINGS_FILE_NAME))
    || normalized === path.normalize(path.join(legacyMemoryDir, SETTINGS_FILE_NAME));
}

async function renameLegacyMonthlyDataFiles(dataDirectory) {
  try {
    const entries = await fs.readdir(dataDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(LEGACY_MONTHLY_DATA_FILE_REGEX);
      if (!match) continue;
      const oldPath = path.join(dataDirectory, entry.name);
      const newPath = path.join(dataDirectory, `${DATA_FILE_PREFIX}${match[1]}.json`);
      await renameFileIfNeeded(oldPath, newPath);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function moveMonthlyDataFilesIntoMonthDirectories(dataDirectory) {
  try {
    const entries = await fs.readdir(dataDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(DATA_FILE_REGEX);
      if (!match) continue;
      await renameFileIfNeeded(
        path.join(dataDirectory, entry.name),
        getMonthlyDataPath(dataDirectory, match[1])
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function renameFileIfNeeded(oldPath, newPath) {
  if (oldPath === newPath || !(await fileExists(oldPath)) || (await fileExists(newPath))) return;
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  try {
    await fs.rename(oldPath, newPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(oldPath, newPath);
    await fs.unlink(oldPath);
  }
}

async function moveFileIfNeeded(oldPath, newPath) {
  return renameFileIfNeeded(oldPath, newPath);
}

async function writeJsonFileIfChanged(filePath, data) {
  const text = JSON.stringify(data, null, 2);
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing === text) return;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.code === 'EPERM' || error.code === 'EACCES') return;
      throw error;
    }
  }

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, text, 'utf8');
  } catch (error) {
    if ((error.code === 'EPERM' || error.code === 'EACCES') && (await fileExists(filePath))) return;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function readMonthlyDataFiles(filePaths) {
  const combined = createDefaultData();

  const monthlyShards = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      return normalizeData(JSON.parse(text));
    } catch (error) {
      // Ignore unreadable monthly shards so one damaged month does not block startup.
      return null;
    }
  }));

  // Promise.all preserves filePaths order, so profile precedence remains the
  // same as the former sequential reader while disk waits can overlap.
  for (const data of monthlyShards) {
    if (!data) continue;
    combined.tasks.push(...data.tasks);
    combined.journals.push(...data.journals);
    combined.profile = { ...combined.profile, ...data.profile };
    combined.updatedAt = data.updatedAt || combined.updatedAt;
  }

  combined.tasks = dedupeById(combined.tasks);
  combined.journals = dedupeById(combined.journals);
  return combined;
}

async function readLegacyData(dataDirectory) {
  const filePath = path.join(dataDirectory, LEGACY_DATA_FILE_NAME);

  try {
    const text = await fs.readFile(filePath, 'utf8');
    return {
      ...normalizeData(JSON.parse(text)),
      hasData: true
    };
  } catch (error) {
    return {
      ...createDefaultData(),
      hasData: false
    };
  }
}

async function writeMonthlyDataFiles(dataDirectory, data, updatedAt, options = {}) {
  const existingFiles = await listMonthlyDataFiles(dataDirectory);
  const byMonth = new Map();

  data.tasks.forEach((task) => {
    collectDateMonths(task.date).forEach((monthKey) => {
      ensureMonthData(byMonth, monthKey, data.profile, updatedAt).tasks.push(task);
    });
  });

  data.journals.forEach((journal) => {
    const normalizedJournal = normalizeJournalForStorage(journal);
    collectDateMonths(normalizedJournal.dateRangeStart || normalizedJournal.date, normalizedJournal.dateRangeEnd).forEach((monthKey) => {
      ensureMonthData(byMonth, monthKey, data.profile, updatedAt).journals.push(normalizedJournal);
    });
  });

  for (const [monthKey, monthData] of byMonth.entries()) {
    const filePath = getMonthlyDataPath(dataDirectory, monthKey);
    monthData.tasks = dedupeById(monthData.tasks);
    monthData.journals = dedupeById(monthData.journals);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (options.preserveExistingMonths) {
      const existing = await readOptionalJsonStrict(filePath);
      if (existing) {
        await backupExistingFile(filePath);
        Object.assign(monthData, { ...existing, ...monthData });
      }
    }
    if (options.preserveExistingMonths) await writeJsonAtomically(filePath, monthData);
    else await fs.writeFile(filePath, JSON.stringify(monthData, null, 2), 'utf8');
  }

  if (options.preserveExistingMonths) return;
  const activeFileNames = new Set(Array.from(byMonth.keys()).map((monthKey) => `${DATA_FILE_PREFIX}${monthKey}.json`));
  for (const filePath of existingFiles) {
    if (!activeFileNames.has(path.basename(filePath))) {
      await removeFileIfExists(filePath, []);
    }
  }
}

function ensureMonthData(byMonth, monthKey, profile, updatedAt) {
  if (!byMonth.has(monthKey)) {
    byMonth.set(monthKey, {
      version: 2,
      month: monthKey,
      tasks: [],
      journals: [],
      profile,
      updatedAt
    });
  }

  return byMonth.get(monthKey);
}

async function saveProfileToSettings(app, profile) {
  const settings = await readSettings(app);
  await writeSettings(app, {
    ...settings,
    profile
  });
}

async function removeMonthlyDataFiles(dataDirectory, deleted) {
  const monthlyFiles = await listMonthlyDataFiles(dataDirectory);
  for (const filePath of monthlyFiles) {
    await removeFileIfExists(filePath, deleted);
  }
}

async function removeFileIfExists(filePath, deleted) {
  try {
    await fs.unlink(filePath);
    deleted.push(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function removeDirectoryIfExists(directoryPath, deleted) {
  try {
    await fs.rm(directoryPath, { recursive: true, force: true });
    deleted.push(directoryPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function normalizeData(data) {
  return {
    version: Number(data && data.version) || 2,
    tasks: Array.isArray(data && data.tasks) ? data.tasks : [],
    journals: Array.isArray(data && data.journals) ? data.journals : [],
    profile: data && typeof data.profile === 'object' && !Array.isArray(data.profile) ? data.profile : {},
    updatedAt: data && data.updatedAt ? data.updatedAt : new Date().toISOString()
  };
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item && item.id ? item.id : JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeJournalForStorage(journal) {
  const dateRangeStart = normalizeDate(journal && journal.dateRangeStart);
  const dateRangeEnd = normalizeDate(journal && journal.dateRangeEnd);
  const date = dateRangeStart || normalizeDate(journal && journal.date);
  const { rating, tagId, tagIds, ...journalWithoutLegacyTags } = journal || {};
  const legacyTagId = tagId || legacyRatingToTagId(rating);

  return {
    ...journalWithoutLegacyTags,
    date,
    dateRangeStart,
    dateRangeEnd,
    tagIds: normalizeJournalTagIds([...(Array.isArray(tagIds) ? tagIds : []), legacyTagId])
  };
}

function collectDateMonths(startDate, endDate = '') {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate) || start;
  if (!start) return [];
  if (!end || end < start) return [monthKeyFromDateString(start)];

  const months = [];
  const cursor = parseLocalDate(start);
  const finish = parseLocalDate(end);

  while (cursor <= finish) {
    const monthKey = monthKeyFromDate(cursor);
    if (!months.includes(monthKey)) months.push(monthKey);
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }

  return months;
}

function monthKeyFromDateString(date) {
  return normalizeDate(date).slice(0, 7);
}

function monthKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseLocalDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

module.exports = {
  createDefaultData,
  getDefaultMemoryDir,
  getStoragePaths,
  loadData,
  resetData,
  saveData,
  setStorageRoot,
  previewStorageRoot
};
