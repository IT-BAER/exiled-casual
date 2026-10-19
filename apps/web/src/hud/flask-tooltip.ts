import { FLASK_CHARGES_PER_KILL, FLASK_RECOVERY_PCT } from "@exiled/rules";

/**
 * A flask's tooltip, laid out like PoE2's flask box (poe2db.tw Lesser Life Flask):
 * recovery, charge cost, current charges, then the grey line saying how to drink it.
 * The sim spends exactly one charge per drink (systems/flask.ts).
 */
export function flaskTooltip(kind: "life" | "mana", key: string, charges: number, max: number) {
  const pool = kind === "life" ? "Life" : "Mana";
  return {
    name: `${pool} Flask`,
    rarity: "normal",
    itemClass: "flask",
    lines: [
      `Recovers ${FLASK_RECOVERY_PCT}% of maximum ${pool} instantly`,
      `Consumes 1 of ${max} Charges on use`,
      `Currently has ${charges} Charges`,
    ],
    help: `Press ${key.toUpperCase()} to drink. Gains ${FLASK_CHARGES_PER_KILL} Charge per kill. Refills in your hideout.`,
  };
}
