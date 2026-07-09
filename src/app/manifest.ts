import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Curioflow",
    short_name: "Curioflow",
    description: "Personal reading flow and knowledge library",
    start_url: "/home",
    display: "standalone",
    background_color: "#f6f4ef",
    theme_color: "#f6f4ef",
    icons: [
      {
        src: "/app-icon-192",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/app-icon-512",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };
}
