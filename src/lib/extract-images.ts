/**
 * Extract all image URLs from a Facebook post object returned by RapidAPI.
 * Handles all known field formats from facebook-scraper3.
 */
export function extractImages(post: Record<string, unknown>): string[] {
  const images: string[] = [];

  // Direct string fields
  const directFields = ["photo_url", "image", "full_picture", "picture", "video_thumbnail"];
  for (const field of directFields) {
    if (typeof post[field] === "string" && post[field]) {
      images.push(post[field] as string);
    }
  }

  // Array of strings
  const arrayFields = ["images", "photos"];
  for (const field of arrayFields) {
    if (Array.isArray(post[field])) {
      for (const item of post[field] as unknown[]) {
        if (typeof item === "string") images.push(item);
        // Could also be objects with url/src
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          if (typeof obj.url === "string") images.push(obj.url);
          if (typeof obj.src === "string") images.push(obj.src);
          if (typeof obj.image === "string") images.push(obj.image);
        }
      }
    }
  }

  // album_preview - array of { type, image_file_uri, url, id }
  if (post.album_preview) {
    const album = Array.isArray(post.album_preview) ? post.album_preview : [post.album_preview];
    for (const item of album) {
      if (typeof item === "string") {
        images.push(item);
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        // facebook-scraper3 format: image_file_uri is the actual image URL
        if (typeof obj.image_file_uri === "string") images.push(obj.image_file_uri);
        if (typeof obj.src === "string") images.push(obj.src);
        if (typeof obj.image === "string") images.push(obj.image);
        // Nested image object
        if (typeof obj.image === "object" && obj.image !== null) {
          const img = obj.image as Record<string, unknown>;
          if (typeof img.url === "string") images.push(img.url);
          if (typeof img.src === "string") images.push(img.src);
          if (typeof img.image_file_uri === "string") images.push(img.image_file_uri);
        }
      }
    }
  }

  // Nested attachments (Graph API style)
  if (post.attachments) {
    const atts = Array.isArray(post.attachments) ? post.attachments : [post.attachments];
    for (const att of atts) {
      if (typeof att !== "object" || att === null) continue;
      const a = att as Record<string, unknown>;
      // media.image.src
      if (typeof a.media === "object" && a.media !== null) {
        const media = a.media as Record<string, unknown>;
        if (typeof media.image === "object" && media.image !== null) {
          const img = media.image as Record<string, unknown>;
          if (typeof img.src === "string") images.push(img.src);
          if (typeof img.url === "string") images.push(img.url);
        }
        if (typeof media.src === "string") images.push(media.src);
      }
      // Direct URL that looks like an image
      if (typeof a.url === "string" && /\.(jpg|jpeg|png|webp|gif)/i.test(a.url)) {
        images.push(a.url);
      }
      // subattachments
      if (typeof a.subattachments === "object" && a.subattachments !== null) {
        const sub = a.subattachments as Record<string, unknown>;
        const subData = Array.isArray(sub.data) ? sub.data : [];
        for (const s of subData) {
          if (typeof s !== "object" || s === null) continue;
          const sd = s as Record<string, unknown>;
          if (typeof sd.media === "object" && sd.media !== null) {
            const m = sd.media as Record<string, unknown>;
            if (typeof m.image === "object" && m.image !== null) {
              const img = m.image as Record<string, unknown>;
              if (typeof img.src === "string") images.push(img.src);
            }
          }
        }
      }
    }
  }

  // Attached post
  if (typeof post.attached_post === "object" && post.attached_post !== null) {
    const ap = post.attached_post as Record<string, unknown>;
    for (const field of ["photo_url", "image", "full_picture"]) {
      if (typeof ap[field] === "string" && ap[field]) {
        images.push(ap[field] as string);
      }
    }
  }

  // Deduplicate and filter empty
  return Array.from(new Set(images.filter(Boolean)));
}
