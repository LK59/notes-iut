import { GENERATED_BUILD_ID } from "./generatedBuild";

export const APP_VERSION = "0.1.0";
export const BUILD_ID = import.meta.env.VITE_BUILD_ID || GENERATED_BUILD_ID;
