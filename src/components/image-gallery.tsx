"use client";

export function ImageGallery({ images }: { images: string[] }) {
  if (!images?.length) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {images.map((url, i) => (
        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
          <div className="relative aspect-video rounded-lg overflow-hidden bg-secondary border border-border hover:border-primary/50 transition-colors">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Photo ${i + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).parentElement!.innerHTML =
                  '<div class="flex items-center justify-center h-full text-xs text-muted-foreground">Image indisponible</div>';
              }}
            />
          </div>
        </a>
      ))}
    </div>
  );
}
