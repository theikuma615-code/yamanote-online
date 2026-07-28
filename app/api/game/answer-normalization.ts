export type AnswerTopic = {
  name: string;
  aliases?: Record<string, string>;
};

const countryAliases: Record<string, string> = {
  アメリカ合衆国: "アメリカ",
  米国: "アメリカ",
  英国: "イギリス",
  大韓民国: "韓国",
  中華人民共和国: "中国",
  ロシア連邦: "ロシア",
  バチカン市国: "バチカン",
  チェコ共和国: "チェコ",
};

function normalizeSurface(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/[ 　・･。、,.\-ー]/g, "")
    .replace(/[ァ-ヶ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    );
}

function applyAliases(result: string, aliases?: Record<string, string>) {
  if (!aliases) return result;
  for (const [variant, canonical] of Object.entries(aliases)) {
    if (normalizeSurface(variant) === result) return normalizeSurface(canonical);
  }
  return result;
}

export function normalizeAnswer(value: string, topic?: AnswerTopic | null) {
  let result = normalizeSurface(value);
  if (topic?.name === "山手線の駅") result = result.replace(/駅$/, "");
  if (topic?.name === "都道府県") result = result.replace(/[都道府県]$/, "");
  if (topic?.name === "東京23区") result = result.replace(/区$/, "");
  if (topic?.name === "政令指定都市") result = result.replace(/市$/, "");
  if (topic?.name === "アメリカの州") result = result.replace(/州$/, "");
  if (topic?.name === "県庁所在地") result = result.replace(/[市区]$/, "");
  if (
    topic?.name === "国" ||
    topic?.name === "EU加盟国" ||
    topic?.name === "赤道が通る国"
  ) {
    result = applyAliases(result, countryAliases);
  }
  return applyAliases(result, topic?.aliases);
}
