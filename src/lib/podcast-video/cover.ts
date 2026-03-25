export const DEFAULT_PODCAST_VIDEO_COVER_PATH = '/root/AiPodcast/podcast_cover.png';

export function getPodcastVideoCoverPath(): string {
  return (
    process.env.PODCAST_VIDEO_IMAGE_PATH?.trim() || DEFAULT_PODCAST_VIDEO_COVER_PATH
  ).trim();
}
