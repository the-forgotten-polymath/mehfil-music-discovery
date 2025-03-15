"use client";

import { Heart } from "lucide-react";
import { burstAt } from "@/components/like-burst";
import { isFavourite, toggleFavourite, useIsFavourite } from "@/lib/favourites";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The one control that likes a song.
 *
 * Always rendered rather than revealed on hover, so nothing shifts when the
 * state changes and it is reachable on a phone, where there is no hover to
 * reveal anything.
 */
export function LikeButton({
  songId,
  className = "",
  size = 16,
}: {
  songId: number;
  className?: string;
  size?: number;
}) {
  const liked = useIsFavourite(songId);
  // Same string powers the accessible name and the tooltip, so the two can
  // never say different things about what the button currently does.
  const label = liked ? "Remove from favourites" : "Add to favourites";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-pressed={liked}
            aria-label={label}
            onClick={(event) => {
              // In a track row this sits inside a button that starts the song, so the
              // click must stop here or liking would also play something. Harmless at
              // the player's own call sites, where nothing above it acts on a click.
              event.stopPropagation();

              // Read before toggling: the burst celebrates liking, and firing it on
              // removal would read as mockery.
              const willLike = !isFavourite(songId);
              toggleFavourite(songId);

              if (willLike) {
                const box = event.currentTarget.getBoundingClientRect();
                burstAt(box.left + box.width / 2, box.top + box.height / 2);
              }
            }}
            className={`grid shrink-0 place-items-center rounded-full transition active:scale-90 ${
              liked
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            } ${className}`}
          />
        }
      >
        <Heart
          style={{ width: size, height: size }}
          // Only the fill animates. Scaling the icon would move it inside a fixed
          // grid cell and shift whatever sits beside it.
          className={`transition-transform duration-200 ${liked ? "fill-current scale-110" : "scale-100"}`}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
