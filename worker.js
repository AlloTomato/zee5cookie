/**
 * Zee5 hdntl Cookie Generator for Cloudflare Workers
 * Route: http://zee5cookie.hakunamata.workers.dev/cookie
 */

const CACHE_TTL = 28800; // 8 hours in seconds
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only respond to the /cookie path
    if (url.pathname !== "/cookie") {
      return new Response("Not Found", { status: 404 });
    }

    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), request);
    const cache = caches.default;

    // 1. Check Cloudflare Cache first
    let response = await cache.match(cacheKey);
    if (response) {
      return response;
    }

    try {
      // 2. Generate new cookie if not in cache
      const cookie = await generateZee5Cookie();

      // 3. Create response and set Cache-Control for 8 hours
      response = new Response(cookie, {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": `public, max-age=${CACHE_TTL}`,
          "Access-Control-Allow-Origin": "*",
        },
      });

      // Store in cache
      ctx.waitUntil(cache.put(cacheKey, response.clone()));

      return response;
    } catch (error) {
      return new Response("Error: " + error.message, { status: 500 });
    }
  }
};

/** --- Logic Functions --- **/

async function generateZee5Cookie() {
  // 1. Fetch Platform Token
  const webPage = await fetch("https://www.zee5.com/live-tv/aaj-tak/0-9-aajtak", {
    headers: { "User-Agent": USER_AGENT }
  }).then(r => r.text());

  const tokenMatch = webPage.match(/"gwapiPlatformToken"\s*:\s*"([^"]+)"/);
  if (!tokenMatch) throw new Error("Could not find Platform Token");
  
  const platformToken = tokenMatch[1];
  const guestToken = crypto.randomUUID();

  // 2. Playback API Payload
  const ddToken = btoa(JSON.stringify({
    "schema_version": "1",
    "platform_name": "Chrome",
    "platform_version": "104",
    "app_name": "Web",
    "app_version": "2.52.31",
    "player_capabilities": {
      "audio_channel": ["STEREO"],
      "video_codec": ["H264"],
      "container": ["MP4", "TS"],
      "package": ["DASH", "HLS"]
    }
  }));

  const apiUrl = `https://spapi.zee5.com/singlePlayback/getDetails/secure?channel_id=0-9-9z583538&device_id=${guestToken}&platform_name=desktop_web&country=IN&app_version=4.24.0&user_type=guest`;

  const apiRes = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": platformToken,
      "X-Z5-Guest-Token": guestToken,
      "x-dd-token": ddToken,
      "User-Agent": USER_AGENT,
      "Origin": "https://www.zee5.com",
      "Referer": "https://www.zee5.com/"
    },
    body: JSON.stringify({})
  }).then(r => r.json());

  if (!apiRes.keyOsDetails || !apiRes.keyOsDetails.video_token) {
    throw new Error("Playback API failed");
  }

  // 3. Request Manifest to capture hdntl
  const m3u8Url = apiRes.keyOsDetails.video_token;
  const m3u8Res = await fetch(m3u8Url, {
    headers: { "User-Agent": USER_AGENT }
  }).then(r => r.text());

  const cookieMatch = m3u8Res.match(/hdntl=[^;\s"]+/);
  if (!cookieMatch) throw new Error("hdntl cookie not found in stream");

  return cookieMatch[0];
}
