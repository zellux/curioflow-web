import { register } from "node:module";

register("./test-alias-loader.mjs", import.meta.url);
register("./service-test-auth-loader.mjs", import.meta.url);
