# Lounj

Find hookah lounges near you, anywhere in the world.

- **Live app:** deployed on Cloudflare Workers (static app in `public/`, API in `worker.js`).
- **Listings:** OpenStreetMap by default (free, worldwide). Add the secret `GOOGLE_PLACES_KEY` to switch to Google Places (ratings, photos, phone, hours).
- **Requests & claims:** guests can request online booking and owners can claim a listing. Add a KV namespace bound as `LOUNJ_KV` to store them, and the secret `ADMIN_TOKEN` to view them at `/api/requests?token=...`.

## Develop

```
npx wrangler dev
```

## Data credits

Map data © OpenStreetMap contributors (ODbL). Geocoding by Nominatim. Please respect the
[Nominatim](https://operations.osmfoundation.org/policies/nominatim/) and
[tile](https://operations.osmfoundation.org/policies/tiles/) usage policies; switch to a commercial
provider as traffic grows.
