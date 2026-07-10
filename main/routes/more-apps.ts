/**
 * GET /api/more-apps
 * Returns the catalog of companion apps (e.g. RevFlo) shown on the
 * Settings → More Apps tab, with a QR code per store link so a phone
 * can scan-to-download instead of typing a URL.
 *
 * Store links are filled in once each app actually has a published
 * listing — update MORE_APPS below when that happens, no schema change needed.
 */
import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';

const router = Router();

type AppEntry = {
  id: string;
  name: string;
  tagline: string;
  iosUrl: string | null;
  androidUrl: string | null;
};

const MORE_APPS: AppEntry[] = [
  {
    id: 'revflo',
    name: 'RevFlo',
    tagline: 'See live sales, daily summaries, and reports for your store from your phone.',
    iosUrl: null,
    androidUrl: null,
  },
];

router.get('/', async (_req: Request, res: Response) => {
  const apps = await Promise.all(
    MORE_APPS.map(async (app) => {
      const primaryUrl = app.iosUrl || app.androidUrl;
      let qrDataUrl: string | null = null;
      if (primaryUrl) {
        try {
          qrDataUrl = await QRCode.toDataURL(primaryUrl, { errorCorrectionLevel: 'M', width: 256 });
        } catch (err) {
          console.warn(`[MoreApps] QR generation failed for ${app.id}:`, err);
        }
      }
      return {
        id: app.id,
        name: app.name,
        tagline: app.tagline,
        ios_url: app.iosUrl,
        android_url: app.androidUrl,
        qr_data_url: qrDataUrl,
        available: Boolean(primaryUrl),
      };
    })
  );

  res.json({ apps });
});

export const moreAppsRoutes = router;
