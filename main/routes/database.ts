import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { getDatabase, getDbPath, createBackup, getCurrentSchemaVersion } from '../db';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

router.get('/export', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_flo_meta'
    `).all() as { name: string }[];

    const exportData: Record<string, any[]> = {};

    for (const { name: tableName } of tables) {
      exportData[tableName] = db.prepare(`SELECT * FROM ${tableName}`).all();
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `flo-export-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json({
      version: 1,
      app: 'FloDesktop',
      exported_at: new Date().toISOString(),
      schema_version: String(getCurrentSchemaVersion()),
      data: exportData,
    });
  } catch (error: any) {
    console.error('[DB Export] Error:', error);
    res.status(500).json({ error: 'Export failed: ' + error.message });
  }
});

router.post('/import', async (req: Request, res: Response) => {
  try {
    const { data, overwrite } = req.body;

    if (!data || !data.data || typeof data.data !== 'object') {
      return res.status(400).json({ error: 'Invalid import file format' });
    }

    const db = getDatabase();
    const importData = data.data as Record<string, any[]>;
    const importSchemaVersion = parseInt(data.schema_version || '0', 10);

    const requiredTables = ['settings', 'categories', 'products', 'users'];
    const importedTables = Object.keys(importData);
    
    const missingTables = requiredTables.filter(t => !importedTables.includes(t));
    if (missingTables.length > 0) {
      return res.status(400).json({ 
        error: `Missing required tables: ${missingTables.join(', ')}` 
      });
    }

    const { path: backupPath } = await createBackup();
    const hasVersionMismatch = importSchemaVersion !== getCurrentSchemaVersion();

    if (hasVersionMismatch) {
      console.log(`[DB Import] Version mismatch: import v${importSchemaVersion} vs current v${getCurrentSchemaVersion()}. Using data-only merge.`);
    }

    db.exec('BEGIN IMMEDIATE');
    
    try {
      for (const tableName of importedTables) {
        const rows = importData[tableName];
        if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

        const currentCols = getTableColumns(db, tableName);
        const importCols = Object.keys(rows[0]);
        const commonCols = hasVersionMismatch 
          ? importCols.filter(c => currentCols.includes(c))
          : importCols;

        if (commonCols.length === 0) continue;

        if (overwrite || hasVersionMismatch) {
          db.exec(`DELETE FROM ${tableName}`);
        }

        const colList = commonCols.join(', ');
        const placeholders = commonCols.map(() => '?').join(', ');
        const insertStmt = db.prepare(
          `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`
        );
        
        for (const row of rows) {
          insertStmt.run(...commonCols.map(col => row[col]));
        }
        
        console.log(`[DB Import] ${tableName}: ${rows.length} rows (${commonCols.length} columns)`);
      }
      
      db.exec('COMMIT');
      res.json({ 
        success: true, 
        message: hasVersionMismatch 
          ? 'Data imported with schema compatibility (some fields may be missing)'
          : 'Database imported successfully',
        backup: backupPath,
        schemaVersionMismatch: hasVersionMismatch,
        importedSchemaVersion: importSchemaVersion,
        currentSchemaVersion: getCurrentSchemaVersion()
      });
    } catch (err: any) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (error: any) {
    console.error('[DB Import] Error:', error);
    res.status(500).json({ error: 'Import failed: ' + error.message });
  }
});

function getTableColumns(db: Database.Database, tableName: string): string[] {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
    return columns.map(col => col.name);
  } catch {
    return [];
  }
}

router.get('/backup', async (req: Request, res: Response) => {
  try {
    const { path: backupPath, schemaVersion } = await createBackup();
    res.json({ 
      success: true, 
      path: backupPath,
      filename: path.basename(backupPath),
      schemaVersion
    });
  } catch (error: any) {
    console.error('[DB Backup] Error:', error);
    res.status(500).json({ error: 'Backup failed: ' + error.message });
  }
});

router.get('/download', (req: Request, res: Response) => {
  try {
    const dbPath = getDbPath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `flo-database-${timestamp}.db`;
    
    res.download(dbPath, filename);
  } catch (error: any) {
    console.error('[DB Download] Error:', error);
    res.status(500).json({ error: 'Download failed: ' + error.message });
  }
});

router.get('/tables', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_flo_meta'
      ORDER BY name
    `).all() as { name: string }[];

    const tableInfo = tables.map(({ name: tableName }) => {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number };
      return { name: tableName, rows: count.count };
    });

    res.json({ tables: tableInfo });
  } catch (error: any) {
    console.error('[DB Tables] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export const databaseRoutes = router;
