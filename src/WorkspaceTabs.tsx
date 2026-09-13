export function WorkspaceTabs({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          id={id + "-tab-" + item.key}
          aria-controls={id + "-panel-" + item.key}
          aria-selected={value === item.key}
          tabIndex={value === item.key ? 0 : -1}
          onClick={() => onChange(item.key)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % items.length
                : event.key === "ArrowLeft"
                  ? (index + items.length - 1) % items.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            onChange(items[next].key);
            document.getElementById(id + "-tab-" + items[next].key)?.focus();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
