<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/15ULsIQi1o_8MtGRESB4-cB_GcZCS30J3

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Image generation latency

Illustrations use `gemini-3.1-flash-lite-image`. The separate story-bible text
step uses `gemini-3.5-flash-lite`.

The timeline shows all illustrations in the current story, including the
selected picture. It scrolls horizontally when needed. Pictures are kept in
page memory only and are cleared on refresh or when starting a new story.

The image endpoint logs one `image_generation_timing` JSON record when its
response finishes or its connection closes. Durations are in milliseconds:
total server time, authentication, credit reservation, and each Gemini model.
Model durations include retry backoff. The record also includes model attempt
counts, whether a previous image was used, and whether story processing fell
back to the narration. It contains no narration, image, account ID, or
credentials. A null stage duration means the stage had not completed.

Inspect recent production runtime logs with `vercel logs runtime --environment
production --since 30m --json --query 'requestPath:"/api/generate-image"'`
and select records whose message has `event: image_generation_timing`, subject
to the project's plan and log retention. Compare successful finished requests
with and without references, including sample counts, median and tail latency;
review failures, closed connections and fallbacks separately. Server total
ends when Node finishes writing the response, not when the browser decodes or
paints the image, and excludes narration and app queueing time. Hard function
termination may prevent a final timing record.

The browser requests a streaming response for image generation. The server
signals when the image model starts, and the painting indicator appears
immediately. Completing or failing the request removes the indicator.
Clients that do not request streaming still receive the
original JSON response; a streaming error after headers have been sent is
reported in the response body and recorded as status 502 in timing logs.

The downloadable debug log records the narration length sent to the API before
validation, and, once image generation starts, the actual story-model and
image-model text prompt lengths per attempt. Counts use JavaScript string
length (UTF-16 code units); they are not tokens and exclude reference-image
data. Rejected requests do not reach either model. Retries reuse the prompt.
The debug console follows new entries while scrolled to the bottom. Scrolling
up or holding the pointer in the log pauses automatic scrolling; return to the
bottom to resume following new entries.

Speech buffering prefers finalized recognition results. If interim speech
reaches 70 words without being finalized, a two-second fallback uses the
unprocessed portion and tracks it across subsequent revisions. Pending
narration is split into requests of at most 4,000 UTF-16 code units; requests
remain sequential so each illustration can reference the preceding picture.
If a later revision no longer contains the used boundary, the debug log warns
that the app is continuing from the previous word position.
