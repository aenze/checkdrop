import { intlLocale, t } from "../i18n";

export type Instance = {
  readonly version: string;
  readonly update: {
    readonly auto_update: boolean;
    readonly latest_version: string | null;
    readonly checked_at: string | null;
    readonly available: boolean;
    readonly last_update: {
      readonly state: "succeeded" | "rolled_back" | "failed";
      readonly from: string;
      readonly to: string;
      readonly at: string;
    } | null;
  } | null;
  readonly address_data: {
    readonly state: "ready" | "importing" | "failed" | "missing";
    readonly effective_at: string | null;
    readonly row_count: number | null;
    readonly message: string | null;
  };
};

const date = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" });
const count = new Intl.NumberFormat(intlLocale);

export function updateText(instance: Instance): string {
  const update = instance.update;
  if (!update)
    return t(
      "Aktualizace spravuje provozovatel serveru.",
      "Updates are managed by the server operator.",
    );
  const last = update.last_update;
  if (last && last.state !== "succeeded" && last.to === update.latest_version)
    return t(
      `Aktualizace na ${last.to} se nepovedla, běží dál ${instance.version}.`,
      `The update to ${last.to} failed; ${instance.version} keeps running.`,
    );
  if (update.available && update.latest_version)
    return update.auto_update
      ? t(
          `Verze ${update.latest_version} se nainstaluje při příští automatické aktualizaci.`,
          `Version ${update.latest_version} will be installed with the next automatic update.`,
        )
      : t(
          `K dispozici je verze ${update.latest_version}. Spusťte ./checkdrop update.`,
          `Version ${update.latest_version} is available. Run ./checkdrop update.`,
        );
  return update.auto_update
    ? t("Aktuální. Aktualizuje se automaticky.", "Up to date. Updates automatically.")
    : t(
        "Aktuální. Automatické aktualizace jsou vypnuté.",
        "Up to date. Automatic updates are off.",
      );
}

export function addressText(instance: Instance): string {
  const data = instance.address_data;
  if (data.state === "ready")
    return t(
      `${count.format(data.row_count ?? 0)} adres, stav k ${data.effective_at ? date.format(new Date(data.effective_at)) : "—"}`,
      `${count.format(data.row_count ?? 0)} addresses as of ${data.effective_at ? date.format(new Date(data.effective_at)) : "—"}`,
    );
  if (data.state === "importing")
    return t(
      "Stahují se. Kontrola adres se zapne sama.",
      "Downloading. Address checks switch on by themselves.",
    );
  if (data.state === "failed")
    return t(
      `Stažení selhalo${data.message ? `: ${data.message}` : "."} Zkusí se znovu v noci.`,
      `Download failed${data.message ? `: ${data.message}` : "."} It will retry tonight.`,
    );
  return t("Zatím nestaženo.", "Not downloaded yet.");
}
