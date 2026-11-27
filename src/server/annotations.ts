import { requireCurrentLibrary, requireCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import type { HighlightColorKey } from "@/app/highlights-copy";

export type LibraryAnnotationEntry = {
  id: string;
  itemId: string;
  quote: string;
  note: string | null;
  colorKey: HighlightColorKey;
  colorHex: string;
  pdfPage: number | null;
  createdAt: string;
  item: {
    id: string;
    title: string;
    author: string | null;
    url: string | null;
    type: string;
    sourceName: string | null;
    archivedAt: string | null;
    starred: boolean;
  };
};

const COLOR_MAP: Record<string, { key: HighlightColorKey; hex: string }> = {
  "#f3d27a": { key: "yellow", hex: "#F3D27A" },
  "#a9d4b2": { key: "green", hex: "#A9D4B2" },
  "#bfd8b8": { key: "green", hex: "#BFD8B8" },
  "#a9c8ec": { key: "blue", hex: "#A9C8EC" },
  "#b8d4ea": { key: "blue", hex: "#B8D4EA" },
  "#eba9a2": { key: "red", hex: "#EBA9A2" },
  "#f1b4a8": { key: "red", hex: "#F1B4A8" }
};

function parseAnnotationLocation(locationJson: string): {
  colorKey: HighlightColorKey;
  colorHex: string;
  pdfPage: number | null;
} {
  try {
    const parsed = JSON.parse(locationJson) as { color?: unknown; page?: unknown };
    const rawColor = typeof parsed.color === "string" ? parsed.color.trim().toLowerCase() : "";
    const mapped = COLOR_MAP[rawColor];
    const pdfPage = typeof parsed.page === "number" && Number.isFinite(parsed.page) && parsed.page > 0
      ? Math.floor(parsed.page)
      : null;

    if (mapped) {
      return { colorKey: mapped.key, colorHex: mapped.hex, pdfPage };
    }

    return {
      colorKey: "yellow",
      colorHex: rawColor.startsWith("#") ? rawColor : "#F3D27A",
      pdfPage
    };
  } catch {
    return { colorKey: "yellow", colorHex: "#F3D27A", pdfPage: null };
  }
}

export async function getLibraryAnnotations(): Promise<LibraryAnnotationEntry[]> {
  const [library, user] = await Promise.all([requireCurrentLibrary(), requireCurrentUser()]);

  const annotations = await prisma.annotation.findMany({
    where: {
      userId: user.id,
      item: {
        libraryId: library.id,
        deletedAt: null
      }
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      itemId: true,
      quote: true,
      note: true,
      locationJson: true,
      createdAt: true,
      item: {
        select: {
          id: true,
          title: true,
          author: true,
          url: true,
          type: true,
          archivedAt: true,
          starred: true,
          source: {
            select: {
              name: true
            }
          }
        }
      }
    }
  });

  return annotations.map((entry) => {
    const location = parseAnnotationLocation(entry.locationJson);
    return {
      id: entry.id,
      itemId: entry.itemId,
      quote: entry.quote,
      note: entry.note,
      colorKey: location.colorKey,
      colorHex: location.colorHex,
      pdfPage: location.pdfPage,
      createdAt: entry.createdAt.toISOString(),
      item: {
        id: entry.item.id,
        title: entry.item.title,
        author: entry.item.author,
        url: entry.item.url,
        type: entry.item.type,
        sourceName: entry.item.source?.name ?? null,
        archivedAt: entry.item.archivedAt?.toISOString() ?? null,
        starred: entry.item.starred
      }
    };
  });
}
