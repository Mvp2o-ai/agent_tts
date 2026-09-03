/**
 * TTS-only number verbalization. Display / transcripts keep canonical digits.
 * Apply after SpeechBuffer flushes a complete phrase. Incomplete numeric tails
 * stay in the buffer so "$1" + ",247.50" is one rewrite, not two.
 */

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
] as const;

const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

const ORDINAL_UNDER_20 = [
  "zeroth",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
] as const;

const ORDINAL_TENS = [
  "",
  "",
  "twentieth",
  "thirtieth",
  "fortieth",
  "fiftieth",
  "sixtieth",
  "seventieth",
  "eightieth",
  "ninetieth",
] as const;

const MONTHS = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const CURRENCY: Record<string, readonly [string, string, string, string]> = {
  $: ["dollar", "dollars", "cent", "cents"],
  "€": ["euro", "euros", "cent", "cents"],
  "£": ["pound", "pounds", "penny", "pence"],
};

function belowHundred(n: number): string {
  if (n < 10) return ONES[n]!;
  if (n < 20) return TEENS[n - 10]!;
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one === 0 ? TENS[ten]! : `${TENS[ten]}-${ONES[one]}`;
}

function belowThousand(n: number): string {
  if (n < 100) return belowHundred(n);
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const head = `${ONES[hundred]} hundred`;
  return rest === 0 ? head : `${head} ${belowHundred(rest)}`;
}

export function cardinalWords(n: number): string {
  if (n < 0) return `minus ${cardinalWords(-n)}`;
  if (n === 0) return "zero";
  if (!Number.isFinite(n) || Math.abs(n) > 999_999_999_999) return String(n);
  let rest = Math.floor(n);
  const parts: string[] = [];
  const billion = Math.floor(rest / 1_000_000_000);
  if (billion) {
    parts.push(`${belowThousand(billion)} billion`);
    rest %= 1_000_000_000;
  }
  const million = Math.floor(rest / 1_000_000);
  if (million) {
    parts.push(`${belowThousand(million)} million`);
    rest %= 1_000_000;
  }
  const thousand = Math.floor(rest / 1_000);
  if (thousand) {
    parts.push(`${belowThousand(thousand)} thousand`);
    rest %= 1_000;
  }
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(" ");
}

function yearWords(year: number): string {
  if (year >= 2010 && year <= 2099) return `twenty ${belowHundred(year % 100)}`;
  if (year >= 2000 && year <= 2009) {
    return year === 2000 ? "two thousand" : `two thousand ${ONES[year % 10]}`;
  }
  if (year >= 1910 && year <= 1999) return `nineteen ${belowHundred(year % 100)}`;
  if (year >= 1900 && year <= 1909) {
    return year === 1900 ? "nineteen hundred" : `nineteen oh ${ONES[year % 10]}`;
  }
  return cardinalWords(year);
}

function ordinalWords(n: number): string {
  if (n < 0 || n > 99) return cardinalWords(n);
  if (n < 20) return ORDINAL_UNDER_20[n]!;
  const ten = Math.floor(n / 10);
  const one = n % 10;
  if (one === 0) return ORDINAL_TENS[ten]!;
  return `${TENS[ten]}-${ORDINAL_UNDER_20[one]}`;
}

function digitsSpoken(raw: string): string {
  return [...raw]
    .filter((ch) => ch >= "0" && ch <= "9")
    .map((ch) => ONES[Number(ch)]!)
    .join(" ");
}

function numberSpoken(wholeStr: string, fracStr: string | undefined): string {
  const compact = wholeStr.replace(/,/g, "");
  if (!compact) return wholeStr;
  if (/^0\d/.test(compact) || compact.length > 15) {
    const head = digitsSpoken(compact);
    if (!fracStr) return head;
    return `${head} point ${[...fracStr].map((d) => ONES[Number(d)]!).join(" ")}`;
  }
  const whole = Number.parseInt(compact, 10);
  if (!Number.isFinite(whole)) return wholeStr;
  if (!fracStr && !wholeStr.includes(",") && compact.length >= 7) {
    return digitsSpoken(compact);
  }
  if (!fracStr && compact.length === 4 && whole >= 1900 && whole <= 2099) {
    return yearWords(whole);
  }
  if (!fracStr) return cardinalWords(whole);
  return `${cardinalWords(whole)} point ${[...fracStr].map((d) => ONES[Number(d)]!).join(" ")}`;
}

function currencySpoken(
  symbol: string,
  wholeStr: string,
  fracStr: string | undefined,
): string {
  const units = CURRENCY[symbol];
  if (!units) return `${symbol}${wholeStr}${fracStr ? `.${fracStr}` : ""}`;
  const [sing, plur, centSing, centPlur] = units;
  const whole = Number.parseInt(wholeStr.replace(/,/g, ""), 10);
  if (!Number.isFinite(whole)) return `${symbol}${wholeStr}`;
  const frac =
    fracStr != null ? Number.parseInt(fracStr.slice(0, 2).padEnd(2, "0"), 10) : 0;
  if (whole === 0 && frac > 0) {
    return `${cardinalWords(frac)} ${frac === 1 ? centSing : centPlur}`;
  }
  const major = `${cardinalWords(whole)} ${whole === 1 ? sing : plur}`;
  if (!frac) return major;
  return `${major} and ${cardinalWords(frac)} ${frac === 1 ? centSing : centPlur}`;
}

function phoneSpoken(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  let rest = digits;
  const groups: string[] = [];
  if (rest.length === 11 && rest.startsWith("1")) {
    groups.push("one");
    rest = rest.slice(1);
  }
  if (rest.length === 10) {
    groups.push(
      digitsSpoken(rest.slice(0, 3)),
      digitsSpoken(rest.slice(3, 6)),
      digitsSpoken(rest.slice(6)),
    );
  } else if (rest.length === 7) {
    groups.push(digitsSpoken(rest.slice(0, 3)), digitsSpoken(rest.slice(3)));
  } else {
    groups.push(digitsSpoken(rest));
  }
  return groups.join(", ");
}

function dateSpoken(month: number, day: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const name = MONTHS[month];
  if (!name) return null;
  return `${name} ${ordinalWords(day)}, ${yearWords(year)}`;
}

function meridiemSpoken(raw: string | undefined): string {
  if (!raw) return "";
  return /p/i.test(raw) ? " P M" : " A M";
}

function timeSpoken(
  hourStr: string,
  minuteStr: string,
  meridiem: string | undefined,
): string {
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);
  if (
    !Number.isFinite(hour) ||
    hour > 23 ||
    !Number.isFinite(minute) ||
    minute > 59
  ) {
    return `${hourStr}:${minuteStr}${meridiem ?? ""}`;
  }
  const hourWords = cardinalWords(hour);
  const suffix = meridiemSpoken(meridiem);
  if (minute === 0) {
    return suffix ? `${hourWords}${suffix}` : `${hourWords} o'clock`;
  }
  const minuteWords = minute < 10 ? `oh ${cardinalWords(minute)}` : belowHundred(minute);
  return `${hourWords} ${minuteWords}${suffix}`;
}

function withProtectedSpans(text: string, rewrite: (exposed: string) => string): string {
  const spans: string[] = [];
  const placeBase = 0xe000;
  const stash = (match: string) => {
    const index = spans.push(match) - 1;
    return String.fromCharCode(placeBase + index);
  };
  const exposed = text
    .replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      stash,
    )
    .replace(/\d+(?:\.\d+){2,}/g, stash);
  return rewrite(exposed).replace(/[\ue000-\uf8ff]/g, (ch) => {
    const index = ch.charCodeAt(0) - placeBase;
    return spans[index] ?? ch;
  });
}

/**
 * Trailing currency / phone / quantity that may still grow as tokens arrive.
 * Returns the start index to hold, or null when the tail is complete speech.
 */
export function incompleteNumericHoldStart(text: string): number | null {
  if (!text) return null;
  const match = text.match(/(?:[$€£]\s*)?(?:\+?\d[\d,.:\-/()]*|\(\d{0,3}|[$€£])$/);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const token = match[0];
  if (start > 0 && /[A-Za-z]/.test(text[start - 1]!) && /^\d/.test(token)) {
    return null;
  }
  if (token.length === 1 && /[.\-/()]/.test(token)) return null;
  return start;
}

export function verbalizeNumbersForTts(text: string): string {
  if (!text) return text;
  return withProtectedSpans(text, (exposed) => {
    let out = exposed;
    out = out.replace(
      /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g,
      (match, year, month, day) => {
        const spoken = dateSpoken(Number(month), Number(day), Number(year));
        return spoken ?? match;
      },
    );
    out = out.replace(
      /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g,
      (match, month, day, year) => {
        const spoken = dateSpoken(Number(month), Number(day), Number(year));
        return spoken ?? match;
      },
    );
    out = out.replace(
      /(?:\+1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}\b/g,
      (match) => phoneSpoken(match),
    );
    out = out.replace(/(?<!\d)(\d{3})[-.](\d{4})(?!\d)/g, (match) => phoneSpoken(match));
    out = out.replace(
      /([$€£])\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g,
      (_match, symbol: string, whole: string, frac?: string) =>
        currencySpoken(symbol, whole, frac),
    );
    out = out.replace(
      /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/gi,
      (match, hour, minute, meridiem?: string) =>
        timeSpoken(hour, minute, meridiem) || match,
    );
    out = out.replace(
      /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*%/g,
      (_match, whole: string, frac?: string) => `${numberSpoken(whole, frac)} percent`,
    );
    out = out.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (match, raw: string) => {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n > 99) return match;
      return ordinalWords(n);
    });
    out = out.replace(
      /(?<![A-Za-z])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?!\.\d)(?![A-Za-z])/g,
      (match, whole: string, frac?: string) => numberSpoken(whole, frac) || match,
    );
    return out;
  });
}
