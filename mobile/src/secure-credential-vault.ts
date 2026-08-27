import * as SecureStore from "expo-secure-store";
import { createCredentialVault } from "./credential-vault";

export const credentialVault = createCredentialVault(SecureStore);
