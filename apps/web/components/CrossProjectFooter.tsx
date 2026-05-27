import { crossProjectFooterDescriptor, crossProjectSiblings } from "@/lib/cross-project";

export default function CrossProjectFooter() {
  return (
    <footer
      data-cross-project-footer
      className="mx-auto mt-8 w-full max-w-6xl border-t border-border/70 px-4 py-5 text-xs text-muted-foreground md:px-8"
    >
      Cross-project:{" "}
      {crossProjectSiblings.map((sibling, index) => (
        <span key={sibling.name}>
          <a href={sibling.statsUrl} className="text-primary hover:underline">
            {sibling.name}
          </a>
          {index < crossProjectSiblings.length - 1 ? " · " : " "}
        </span>
      ))}
      — {crossProjectFooterDescriptor}
    </footer>
  );
}
