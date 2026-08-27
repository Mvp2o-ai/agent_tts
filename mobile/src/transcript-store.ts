import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSessionTranscriptStore } from "./session-transcript";

export const transcriptStore = createSessionTranscriptStore(AsyncStorage);
