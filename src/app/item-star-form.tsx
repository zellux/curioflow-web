import { setItemStarredAction } from "@/app/actions";
import type { SystemLanguage } from "@/app/i18n";
import { ItemActionForm } from "@/app/item-action-form";
import { StarIcon } from "@/app/item-icons";
import { starredCopy } from "@/app/starred-copy";

export function ItemStarForm({ itemId, starred, locale, className }: {
  itemId: string;
  starred: boolean;
  locale: SystemLanguage;
  className: string;
}) {
  const copy = starredCopy(locale);
  return (
    <ItemActionForm action={setItemStarredAction} values={{ itemId, starred: String(!starred) }}
      label={starred ? copy.unstar : copy.star} message={starred ? copy.removed : copy.label}
      locale={locale} className={className} pressed={starred}>
      <StarIcon filled={starred} size={15} />
    </ItemActionForm>
  );
}
