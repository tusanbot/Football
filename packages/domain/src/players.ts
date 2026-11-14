export const NATIONAL_POOLS = [
  { code: "IR", first: ["Arman","Saman","Kian","Mehrdad","Pouya","Nima","Sina","Amir","Navid","Ramin"], last: ["Ahmadi","Hosseini","Karimi","Mohammadi","Rahimi","Moradi","Jafari","Ebrahimi","Azizi","Mousavi"] },
  { code: "BR", first: ["Lucas","Gabriel","Matheus","Rafael","Pedro","Thiago","Bruno","Felipe","Andre","Diego"], last: ["Silva","Santos","Oliveira","Souza","Costa","Pereira","Rodrigues","Almeida","Nascimento","Lima"] },
  { code: "AR", first: ["Mateo","Santiago","Thiago","Benjamin","Nicolas","Lautaro","Tomas","Joaquin","Facundo","Julian"], last: ["Gonzalez","Rodriguez","Fernandez","Lopez","Martinez","Perez","Garcia","Romero","Diaz","Torres"] },
  { code: "ES", first: ["Hugo","Mateo","Martin","Leo","Daniel","Pablo","Alvaro","Adrian","Diego","Sergio"], last: ["Garcia","Fernandez","Gonzalez","Rodriguez","Lopez","Sanchez","Perez","Martin","Gomez","Ruiz"] },
  { code: "FR", first: ["Lucas","Hugo","Louis","Jules","Gabriel","Arthur","Raphael","Theo","Adam","Nathan"], last: ["Martin","Bernard","Dubois","Thomas","Robert","Richard","Petit","Durand","Leroy","Moreau"] },
  { code: "DE", first: ["Leon","Lukas","Paul","Jonas","Felix","Noah","Elias","Finn","Maximilian","Niklas"], last: ["Muller","Schmidt","Schneider","Fischer","Weber","Meyer","Wagner","Becker","Hoffmann","Schulz"] },
  { code: "IT", first: ["Lorenzo","Alessandro","Matteo","Leonardo","Gabriele","Riccardo","Andrea","Federico","Luca","Marco"], last: ["Rossi","Russo","Ferrari","Esposito","Bianchi","Romano","Colombo","Ricci","Marino","Greco"] },
  { code: "GB", first: ["Jack","Harry","Oliver","Charlie","George","James","Thomas","William","Jacob","Oscar"], last: ["Smith","Jones","Taylor","Brown","Williams","Wilson","Johnson","Davies","Robinson","Wright"] },
  { code: "NG", first: ["Chinedu","Kelechi","Emeka","Tunde","Ibrahim","Musa","Obinna","Chukwu","Olu","Seyi"], last: ["Okafor","Adeyemi","Bello","Eze","Ibrahim","Musa","Nwosu","Balogun","Ojo","Okeke"] },
  { code: "JP", first: ["Haruto","Yuto","Sota","Ren","Yuki","Kaito","Riku","Daiki","Takumi","Hiroto"], last: ["Sato","Suzuki","Takahashi","Tanaka","Watanabe","Ito","Yamamoto","Nakamura","Kobayashi","Kato"] },
] as const;

export const SQUAD_POSITIONS = [
  "GK","GK","RB","LB","CB","CB","CB","RB","LB",
  "CDM","CDM","CM","CM","CAM","CAM","RW","LW","ST",
] as const;

export type PlayerPosition = typeof SQUAD_POSITIONS[number];
export type PlayerAttributes = {
  pace: number; shooting: number; passing: number; dribbling: number;
  defending: number; physical: number; goalkeeping: number;
};
export interface GeneratedPlayer {
  firstName: string; lastName: string; nationality: string; age: number;
  position: PlayerPosition; overall: number; potential: number;
  attributes: PlayerAttributes; wage: bigint; contractDays: number;
}
export type RandomInt = (minInclusive: number, maxExclusive: number) => number;

const clamp = (n: number) => Math.max(20, Math.min(95, n));
export function generatePlayer(position: PlayerPosition, randomInt: RandomInt): GeneratedPlayer {
  const country = NATIONAL_POOLS[randomInt(0, NATIONAL_POOLS.length)]!;
  const firstName = country.first[randomInt(0, country.first.length)]!;
  const lastName = country.last[randomInt(0, country.last.length)]!;
  const age = randomInt(18, 35);
  const overall = randomInt(42, 66);
  const potential = Math.max(overall, Math.min(88, overall + randomInt(0, age < 23 ? 25 : 13)));
  const bias = (value: number) => clamp(value + randomInt(-7, 8));
  const goalkeeper = position === "GK";
  const attributes: PlayerAttributes = {
    pace: bias(overall + (["RW","LW","ST","RB","LB"].includes(position) ? 9 : -3)),
    shooting: bias(overall + (["ST","RW","LW","CAM"].includes(position) ? 8 : -5)),
    passing: bias(overall + (["CM","CAM","CDM"].includes(position) ? 8 : 0)),
    dribbling: bias(overall + (["RW","LW","CAM"].includes(position) ? 8 : -1)),
    defending: bias(overall + (["CB","RB","LB","CDM"].includes(position) ? 10 : -9)),
    physical: bias(overall + (["CB","CDM","ST"].includes(position) ? 7 : 0)),
    goalkeeping: goalkeeper ? bias(overall + 10) : randomInt(20, 36),
  };
  // Wage is a weekly Cash amount; keep the starter economy affordable.\n  const wage = BigInt(Math.max(50, overall * 2 + (potential - overall) * 3 + (age < 21 ? 20 : 0)));
  return { firstName, lastName, nationality: country.code, age, position, overall, potential, attributes, wage, contractDays: randomInt(180, 1096) };
}

export function generateStarterSquad(randomInt: RandomInt): GeneratedPlayer[] {
  return SQUAD_POSITIONS.map((position) => generatePlayer(position, randomInt));
}
