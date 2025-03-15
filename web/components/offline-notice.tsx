"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Says so when the network has gone.
 *
 * Everything here streams: the catalogue is fetched, the artwork is hotlinked,
 * and playback is a YouTube iframe. Offline the shell still loads from the
 * cache and then quietly fails to play anything, which reads as the app being
 * broken rather than the connection being absent.
 *
 * navigator.onLine only knows whether an interface is up, not whether anything
 * is reachable through it. That makes it useless for claiming the app works,
 * and reliable for the one thing it is used for here: false means no.
 */
export function OfflineNotice() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Read after mount. The server has no notion of the client's connection,
    // so rendering this from its guess would risk a flash of the wrong state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffline(!navigator.onLine);

    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center p-3"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-card/95 px-4 py-2 text-xs text-muted-foreground shadow-2xl backdrop-blur">
        <WifiOff className="size-3.5 text-destructive" />
        Offline — playback needs a connection
      </div>
    </div>
  );
}
