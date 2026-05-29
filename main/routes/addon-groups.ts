import { Router, Request, Response } from 'express';
import { getDatabase, now, withTxn } from '../db';
import { randomUUID } from 'crypto';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const groups = db.prepare('SELECT * FROM addon_groups ORDER BY sort_order, name').all();

    const groupsWithAddons = groups.map((group: any) => {
      const addons = db.prepare('SELECT * FROM addons WHERE addon_group_id = ? ORDER BY sort_order, name').all(group.id);
      return { ...group, addons };
    });

    res.json({ addon_groups: groupsWithAddons });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    const addons = db.prepare('SELECT * FROM addons WHERE addon_group_id = ? ORDER BY sort_order, name').all(req.params.id);
    res.json({ addon_group: { ...group, addons } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, description, is_required, min_selection, max_selection, sort_order, addons } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const db = getDatabase();
    const groupId = randomUUID();
    const { group, groupAddons } = withTxn(() => {
      db.prepare(`
        INSERT INTO addon_groups (id, name, description, is_required, min_selection, max_selection, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        groupId, name, description || null, is_required ? 1 : 0, min_selection || 0, max_selection || 1, sort_order || 0, now(), now()
      );

      if (addons && addons.length > 0) {
        const insertAddon = db.prepare('INSERT INTO addons (id, addon_group_id, name, price, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        addons.forEach((addon: any, index: number) => {
          insertAddon.run(randomUUID(), groupId, addon.name, addon.price || 0, index, now(), now());
        });
      }

      return {
        group: db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(groupId),
        groupAddons: db.prepare('SELECT * FROM addons WHERE addon_group_id = ?').all(groupId),
      };
    });

    res.status(201).json({ addon_group: Object.assign({}, group, { addons: groupAddons }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    const { name, description, is_required, min_selection, max_selection, sort_order, is_active, addons } = req.body;

    const { updated, updatedAddons } = withTxn(() => {
      db.prepare(`
        UPDATE addon_groups SET name = COALESCE(?, name), description = COALESCE(?, description),
          is_required = COALESCE(?, is_required), min_selection = COALESCE(?, min_selection),
          max_selection = COALESCE(?, max_selection), sort_order = COALESCE(?, sort_order),
          is_active = COALESCE(?, is_active), updated_at = ?
        WHERE id = ?
      `).run(name, description, is_required, min_selection, max_selection, sort_order, is_active, now(), req.params.id);

      if (Array.isArray(addons)) {
        db.prepare('DELETE FROM addons WHERE addon_group_id = ?').run(req.params.id);
        const insertAddon = db.prepare('INSERT INTO addons (id, addon_group_id, name, price, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        addons.forEach((addon: any, index: number) => {
          insertAddon.run(randomUUID(), req.params.id, addon.name, addon.price ?? 0, addon.is_active !== false ? 1 : 0, index, now(), now());
        });
      }

      return {
        updated: db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id),
        updatedAddons: db.prepare('SELECT * FROM addons WHERE addon_group_id = ?').all(req.params.id),
      };
    });

    res.json({ addon_group: Object.assign({}, updated, { addons: updatedAddons }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    withTxn(() => {
      db.prepare('DELETE FROM addons WHERE addon_group_id = ?').run(req.params.id);
      db.prepare('DELETE FROM addon_group_product WHERE addon_group_id = ?').run(req.params.id);
      db.prepare('DELETE FROM addon_groups WHERE id = ?').run(req.params.id);
    });

    res.json({ message: 'Addon group deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Addon management within a group
router.post('/:groupId/addons', (req: Request, res: Response) => {
  try {
    const { name, price, is_active, sort_order } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    const addonId = randomUUID();
    db.prepare('INSERT INTO addons (id, addon_group_id, name, price, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(addonId, req.params.groupId, name, price, is_active !== false ? 1 : 0, sort_order || 0, now(), now());

    const addon = db.prepare('SELECT * FROM addons WHERE id = ?').get(addonId);
    res.status(201).json({ addon });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:groupId/addons/:addonId', (req: Request, res: Response) => {
  try {
    const { name, price, is_active, sort_order } = req.body;

    const db = getDatabase();
    const addon = db.prepare('SELECT * FROM addons WHERE id = ? AND addon_group_id = ?').get(req.params.addonId, req.params.groupId);
    if (!addon) {
      return res.status(404).json({ error: 'Addon not found' });
    }

    db.prepare(`
      UPDATE addons SET name = COALESCE(?, name), price = COALESCE(?, price),
        is_active = COALESCE(?, is_active), sort_order = COALESCE(?, sort_order)
      WHERE id = ?
    `).run(name, price, is_active, sort_order, req.params.addonId);

    const updated = db.prepare('SELECT * FROM addons WHERE id = ?').get(req.params.addonId);
    res.json({ addon: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:groupId/addons/:addonId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const addon = db.prepare('SELECT * FROM addons WHERE id = ? AND addon_group_id = ?').get(req.params.addonId, req.params.groupId);
    if (!addon) {
      return res.status(404).json({ error: 'Addon not found' });
    }

    db.prepare('DELETE FROM addons WHERE id = ?').run(req.params.addonId);
    res.json({ message: 'Addon deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const addonGroupRoutes = router;