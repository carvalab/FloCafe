import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { requireRole } from '../middleware/security';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    let query = 'SELECT * FROM kitchen_stations WHERE 1=1';
    const params: any[] = [];

    if (req.query.active === 'true') {
      query += ' AND is_active = 1';
    }

    query += ' ORDER BY sort_order, name';

    const stations = db.prepare(query).all(...params);
    res.json({ kitchenStations: stations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
    if (!station) {
      return res.status(404).json({ error: 'Kitchen station not found' });
    }

    const tables = db.prepare('SELECT * FROM tables WHERE kitchen_station_id = ?').all(req.params.id);
    res.json({ kitchenStation: { ...station, tables } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const { name, description, category_ids, printer_ip, printer_port, printer_name, sort_order } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO kitchen_stations (name, description, category_ids, printer_ip, printer_port, printer_name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, description || null,
      category_ids ? JSON.stringify(category_ids) : null,
      printer_ip || null, printer_port || 9100, printer_name || null,
      sort_order || 0, now(), now()
    );

    const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ kitchenStation: station });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const { name, description, category_ids, printer_ip, printer_port, printer_name, sort_order, is_active } = req.body;
    const db = getDatabase();

    const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
    if (!station) {
      return res.status(404).json({ error: 'Kitchen station not found' });
    }

    db.prepare(`
      UPDATE kitchen_stations SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        category_ids = COALESCE(?, category_ids),
        printer_ip = COALESCE(?, printer_ip),
        printer_port = COALESCE(?, printer_port),
        printer_name = COALESCE(?, printer_name),
        sort_order = COALESCE(?, sort_order),
        is_active = COALESCE(?, is_active),
        updated_at = ?
      WHERE id = ?
    `).run(
      name, description,
      category_ids ? JSON.stringify(category_ids) : null,
      printer_ip, printer_port, printer_name, sort_order, is_active,
      now(), req.params.id
    );

    const updated = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
    res.json({ kitchenStation: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
    if (!station) {
      return res.status(404).json({ error: 'Kitchen station not found' });
    }

    const assignedTables = db.prepare('SELECT * FROM tables WHERE kitchen_station_id = ?').all(req.params.id);
    if (assignedTables.length > 0) {
      return res.status(400).json({ error: 'Cannot delete station with assigned tables' });
    }

    db.prepare('DELETE FROM kitchen_stations WHERE id = ?').run(req.params.id);
    res.json({ message: 'Kitchen station deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const kitchenStationRoutes = router;
