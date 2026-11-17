import { useEffect, useState } from "react";
import { t } from "../i18n";
import { addressText, type Instance, updateText } from "./installation-status";
import { api } from "./integrations/api";

/** The installation itself; hidden where the server does not report it. */
export default function InstallationStatus() {
  const [instance, setInstance] = useState<Instance | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<Instance>("/instance", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setInstance(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!instance) return null;
  return (
    <section
      className="dashboard-section dashboard-instance"
      aria-label={t("Instalace", "Installation")}
    >
      <header>
        <h2>{t("Instalace", "Installation")}</h2>
      </header>
      <dl>
        <div>
          <dt>
            {t("Verze", "Version")} {instance.version}
          </dt>
          <dd>{updateText(instance)}</dd>
        </div>
        <div>
          <dt>{t("Adresy RÚIAN", "RÚIAN addresses")}</dt>
          <dd>{addressText(instance)}</dd>
        </div>
      </dl>
      <p className="dashboard-instance-source">
        {t("Zdroj adres: ČÚZK, CC BY 4.0", "Address source: ČÚZK, CC BY 4.0")}
      </p>
    </section>
  );
}
