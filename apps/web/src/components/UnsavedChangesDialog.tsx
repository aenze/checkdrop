import { useEffect, useRef } from "react";
import { t } from "../i18n";

export default function UnsavedChangesDialog({
  busy,
  onStay,
  onDiscard,
  onSave,
}: {
  readonly busy: boolean;
  readonly onStay: () => void;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="unsaved-dialog"
      aria-labelledby="unsaved-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onStay();
      }}
    >
      <h2 id="unsaved-title">{t("Máte neuložené změny", "You have unsaved changes")}</h2>
      <p>
        {t(
          "Před pokračováním uložte rozpracované nastavení, nebo změny zahoďte.",
          "Save your changes before continuing, or discard them.",
        )}
      </p>
      <div className="unsaved-actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={onStay}>
          {t("Zůstat", "Stay")}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onDiscard}>
          {t("Zahodit změny", "Discard changes")}
        </button>
        <button type="button" className="primary-button" disabled={busy} onClick={onSave}>
          {busy ? t("Ukládám…", "Saving…") : t("Uložit a pokračovat", "Save and continue")}
        </button>
      </div>
    </dialog>
  );
}
