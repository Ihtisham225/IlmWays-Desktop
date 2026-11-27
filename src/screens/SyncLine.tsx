import type { SyncStatus } from "../../shared/types";
import { formatTime, type Locale, type T } from "../i18n";
import { CloudCheck, CloudOff, Spinner } from "../icons";

/** When the offline copy was last brought up to date (§3.8): every offline screen shows it. */
export function SyncLine({ sync, offline, locale, t }: { sync: SyncStatus; offline: boolean; locale: Locale; t: T }) {
  if (sync.running) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted" role="status">
        <Spinner className="size-3.5" />
        {sync.downloaded > 0 ? t("downloading", { count: sync.downloaded.toLocaleString(locale) }) : t("syncing")}
      </p>
    );
  }
  const when = sync.lastSynced ? t("lastSynced", { time: formatTime(sync.lastSynced, locale) }) : t("neverSynced");
  return (
    <p className="flex items-center gap-2 text-sm text-muted" role="status">
      {offline ? <CloudOff className="size-3.5" /> : <CloudCheck className="size-3.5" />}
      {!offline && sync.firstSyncDone && sync.waiting === 0 && !sync.error ? `${t("syncUpToDate")} · ${when}` : when}
    </p>
  );
}
