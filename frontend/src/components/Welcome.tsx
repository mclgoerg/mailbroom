import { Lock, Undo2, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { Button } from "./ui";

/* Full-screen first-run welcome: what Inboxrake does in three promises, then
 * "Get started" (the setup wizard) or "Set up later" (the app, with its setup
 * cards). Shown by App while no account is set up and the user has not
 * postponed it this session. */

const PROMISES = [
  { icon: Users, key: "welcome.p1" },
  { icon: Undo2, key: "welcome.p2" },
  { icon: Lock, key: "welcome.p3" },
] as const;

export function Welcome({ onStart, onLater }: {
  onStart: () => void; onLater: () => void;
}) {
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus(), []);
  // Esc = "Set up later", like leaving the wizard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onLater();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLater]);
  return (
    <main aria-labelledby="welcome-title"
      className="flex min-h-dvh flex-col items-center justify-center
        bg-surface px-6 py-10
        pt-[max(2.5rem,env(safe-area-inset-top))]
        pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="72"
          height="72" className="mb-6 shrink-0 rounded-dialog" />
        <h1 id="welcome-title" className="type-largetitle">
          {t("welcome.title")}</h1>
        <p className="mt-2 type-body text-muted">{t("welcome.sub")}</p>
        <ul className="mt-8 grid w-full gap-5 text-left">
          {PROMISES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-4">
              <Icon size={18} aria-hidden="true"
                className="mt-0.5 shrink-0 text-accent" />
              <div>
                <h2 className="type-body font-semibold">{t(`${key}.title`)}</h2>
                <p className="type-meta text-muted">{t(`${key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
        <Button ref={start} className="mt-10 w-full max-w-xs" onClick={onStart}>
          {t("welcome.start")}</Button>
        <Button variant="quiet" className="mt-2 text-accent" onClick={onLater}>
          {t("wizard.later")}</Button>
      </div>
    </main>
  );
}
