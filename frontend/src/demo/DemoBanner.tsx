import { Info } from "lucide-react";
import { t } from "../i18n";
import { Button, confirmDialog, Notice } from "../components/ui";

/** The strip above the app while it runs on the in-browser backend. */
export function DemoBanner({ onReset }: { onReset: () => void }) {
  const reset = async () => {
    if (await confirmDialog({
      title: t("demo.reset.title"), body: t("demo.reset.body"),
      confirmLabel: t("demo.reset") })) onReset();
  };
  return (
    <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-5 xl:max-w-360">
      <Notice icon={<Info size={14} />}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t("demo.banner")}</span>
          <span>{t("demo.first_steps")}</span>
          <Button variant="quiet" size="sm" className="-my-1"
            onClick={reset}>{t("demo.reset")}</Button>
        </span>
      </Notice>
    </div>
  );
}
