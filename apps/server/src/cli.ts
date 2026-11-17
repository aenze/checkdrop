import { validateEmail } from "@checkdrop/core";
import { suggestCzechAddresses } from "@checkdrop/db";
import { defaultCountryPack as pack } from "./country-packs.js";
import { lookupEmailDns } from "./dns.js";
import { lookupAresCompany } from "./providers/ares.js";

const argumentsAfterRuntime = process.argv.slice(2);
const [command, ...values] =
  argumentsAfterRuntime[0] === "--" ? argumentsAfterRuntime.slice(1) : argumentsAfterRuntime;
const input = values.join(" ");

if (!command || !input) {
  process.stderr.write(
    "Usage: checkdrop <validate-email|validate-phone|validate-ico|validate-vat|lookup-ares|normalize-address|suggest-address> <value>\n",
  );
  process.exitCode = 2;
} else {
  const output = await run(command, input);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function run(selectedCommand: string, value: string): Promise<unknown> {
  switch (selectedCommand) {
    case "validate-email":
      return validateEmail(value, { lookupDns: lookupEmailDns, rules: pack.emailRules });
    case "validate-phone":
      return pack.phone.validate(value);
    case "validate-ico":
      return pack.company.validateId(value);
    case "validate-vat":
      return pack.company.validateVatId(value);
    case "lookup-ares":
      return lookupAresCompany(value);
    case "normalize-address":
      return { input: value, normalized: pack.address.normalizeSearch(value) };
    case "suggest-address": {
      const connectionString = process.env.CHECKDROP_DATABASE_URL;
      if (!connectionString) {
        throw new Error("CHECKDROP_DATABASE_URL is required for address suggestions.");
      }
      return suggestCzechAddresses(connectionString, value);
    }
    default:
      throw new Error(`Unknown command: ${selectedCommand}`);
  }
}
