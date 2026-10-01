import type { Cell } from './types.ts';

export type CampaignBattleId = 'pearl-harbor' | 'coral-sea' | 'midway' | 'guadalcanal' | 'leyte-gulf';
export type WorldScenario = 'archipelago' | 'test-5x10' | CampaignBattleId;
export type CampaignLandmarkKind = 'airfield' | 'seaplane-base' | 'naval-yard' | 'field-hq';
export type CampaignLocationKind = 'land' | 'sea' | 'strait';

export interface CampaignLandmark extends Cell {
  id: string;
  name: string;
  kind: CampaignLandmarkKind;
  airNation?: 'us'|'jp';
  note: string;
}

export interface CampaignLocation extends Cell {
  name: string;
  kind: CampaignLocationKind;
}

export interface CampaignPort extends Cell { name: string }

export interface CampaignMountainRange {
  /** Normalized ridge centerline in map coordinates. */
  points: [number, number][];
  /** Ridge width in hexes. */
  halfWidth: number;
}

export interface CampaignBattle {
  id: CampaignBattleId;
  title: string;
  date: string;
  theater: string;
  width: number;
  height: number;
  summary: string;
  objective: string;
  sides: [string, string];
  /** Small opening forces selected from the shared asset pool for each side. */
  startingFleetIds: [string[], string[]];
  starts: [Cell, Cell];
  land: number[][][];
  mountainRanges?: CampaignMountainRange[];
  cuts?: number[][][];
  reefs?: { col: number; row: number; rx: number; ry: number; innerRx?: number; innerRy?: number }[];
  landmarks: CampaignLandmark[];
  locations: CampaignLocation[];
  ports: CampaignPort[];
  sources: string[];
}

const NHC = 'https://www.history.navy.mil/browse-by-topic/wars-conflicts-and-operations/world-war-ii';

/** Coordinates are normalized to the map rectangle; polygons are historical-region silhouettes, not navigational charts. */
export const CAMPAIGN_BATTLES: CampaignBattle[] = [
  {
    id: 'pearl-harbor', title: '珍珠港袭击', date: '1941年12月7日', theater: '夏威夷 · 瓦胡岛', width: 100, height: 80,
    summary: '瓦胡岛南岸、珍珠港入口与舰队锚地。以港湾防空、舰队疏散和攻击波次为核心的开篇关卡。',
    objective: '玩家指挥港内守军；敌方由北侧海域进入。双方以少量舰船开局，围绕港湾防空、舰队疏散与攻击波次作战。',
    sides: ['美国太平洋舰队', '日本机动部队'], startingFleetIds: [
      ['lafei','fulaiche','hailunna','kelifulan','huashengdun','qiye'],
      ['lingbo','xuefeng','changliang','gaoxiong','chicheng','xianghe'],
    ], starts: [{ col: 53, row: 61 }, { col: 51, row: 9 }],
    land: [[
      [.07,.48],[.09,.42],[.14,.39],[.15,.34],[.22,.31],[.27,.27],[.34,.28],[.39,.24],[.44,.27],[.49,.25],[.55,.29],[.61,.27],[.67,.30],[.72,.32],[.77,.37],[.84,.38],[.89,.43],[.93,.47],[.91,.51],[.86,.53],[.82,.58],[.76,.59],[.70,.64],[.64,.62],[.60,.57],[.56,.59],[.52,.56],[.47,.59],[.42,.56],[.35,.60],[.30,.58],[.25,.62],[.19,.59],[.14,.56],[.10,.54]
    ], [[.505,.54],[.525,.525],[.55,.53],[.565,.55],[.56,.58],[.54,.59],[.515,.575]]],
    mountainRanges: [
      { points: [[.16,.51],[.25,.46],[.34,.41],[.43,.35],[.49,.34]], halfWidth: 3.2 },
      { points: [[.53,.56],[.59,.50],[.64,.43],[.69,.36],[.75,.43],[.83,.42],[.87,.48]], halfWidth: 3.2 },
    ],
    cuts: [[ [.43,.71],[.43,.59],[.46,.55],[.49,.54],[.51,.57],[.51,.62],[.54,.65],[.58,.62],[.58,.56],[.61,.55],[.65,.59],[.66,.72] ]],
    landmarks: [
      { id:'pearl-yard', name:'珍珠港海军基地', kind:'naval-yard', col:55, row:43, note:'福特岛与港内锚地' },
      { id:'hickam', name:'希卡姆机场', kind:'airfield', airNation:'us', col:68, row:50, note:'瓦胡岛南岸空军基地' },
      { id:'kaneohe', name:'卡内奥赫航空站', kind:'seaplane-base', airNation:'us', col:70, row:40, note:'瓦胡岛东北侧海军航空站' },
    ],
    locations: [
      { name:'瓦胡岛', col:34, row:39, kind:'land' }, { name:'福特岛', col:54, row:55, kind:'land' },
      { name:'港口入口', col:43, row:69, kind:'sea' }, { name:'北太平洋接近海域', col:52, row:15, kind:'sea' },
    ],
    ports: [{ name:'珍珠港锚地', col:53, row:48 }],
    sources: [`${NHC}/1941/pearl-harbor.html`, 'https://www.history.navy.mil/research/archives/digital-exhibits-highlights/action-reports/wwii-pearl-harbor-attack/pearl-harbor-mooring-and-berthing-plans.html'],
  },
  {
    id: 'coral-sea', title: '珊瑚海海战', date: '1942年5月4—8日', theater: '新几内亚南部 · 珊瑚海', width: 128, height: 104,
    summary: '覆盖新几内亚南岸、莫尔兹比港、约克角、路易西亚德群岛与所罗门海域，表现战役范围与航母搜索空间。',
    objective: '围绕侦察、护航与舰载机打击争夺制空权；交战双方舰艇不直接目视接触。',
    sides: ['盟军特混舰队', '日本机动部队'], startingFleetIds: [
      ['lafei','fulaiche','hailunna','baerdimo','qiye','yuekecheng'],
      ['lingbo','xuefeng','changliang','miaogao','chicheng','xianghe'],
    ], starts: [{ col: 42, row: 74 }, { col: 87, row: 61 }],
    land: [
      [[.02,.17],[.07,.13],[.14,.12],[.19,.08],[.28,.10],[.33,.07],[.40,.11],[.47,.09],[.53,.13],[.60,.12],[.65,.16],[.70,.19],[.76,.20],[.79,.25],[.75,.30],[.69,.31],[.65,.36],[.58,.37],[.54,.40],[.48,.38],[.43,.41],[.37,.38],[.32,.40],[.27,.37],[.22,.39],[.17,.35],[.12,.37],[.08,.32],[.03,.30]],
      [[.00,.68],[.03,.64],[.08,.62],[.12,.58],[.16,.60],[.18,.66],[.16,.73],[.15,.82],[.12,.90],[.10,.98],[.00,1]],
      [[.68,.39],[.74,.36],[.81,.38],[.86,.42],[.91,.43],[.94,.48],[.91,.52],[.84,.51],[.80,.54],[.73,.52],[.69,.48]],
      [[.93,.48],[.97,.45],[.995,.48],[.99,.67],[.96,.71],[.93,.63]],
      [[.86,.67],[.90,.65],[.93,.69],[.92,.74],[.89,.78],[.86,.74]],
      [[.80,.59],[.83,.57],[.85,.60],[.84,.64],[.81,.64]], [[.76,.64],[.78,.62],[.80,.65],[.79,.69],[.76,.68]],
      [[.57,.50],[.60,.48],[.63,.51],[.62,.55],[.59,.56]], [[.53,.54],[.55,.52],[.57,.55],[.56,.58],[.53,.58]],
      [[.66,.55],[.69,.53],[.71,.56],[.70,.60],[.67,.60]],
    ],
    mountainRanges: [
      { points: [[.08,.23],[.22,.22],[.36,.24],[.51,.24],[.65,.25],[.76,.24]], halfWidth: 2.8 },
    ],
    landmarks: [
      { id:'port-moresby', name:'莫尔兹比港机场', kind:'airfield', airNation:'us', col:43, row:39, note:'新几内亚南岸盟军空军基地' },
      { id:'rabaul', name:'拉包尔前进基地', kind:'seaplane-base', airNation:'jp', col:98, row:43, note:'俾斯麦群岛日本航空基地' },
      { id:'deboyne', name:'德博因航空站', kind:'field-hq', col:75, row:57, note:'路易西亚德群岛附近水上飞机基地' },
    ],
    locations: [
      { name:'新几内亚', col:36, row:23, kind:'land' }, { name:'莫尔兹比港', col:43, row:39, kind:'land' },
      { name:'珊瑚海', col:56, row:70, kind:'sea' }, { name:'路易西亚德群岛', col:77, row:65, kind:'land' },
      { name:'新不列颠岛', col:102, row:46, kind:'land' }, { name:'托雷斯海峡', col:15, row:59, kind:'strait' },
    ],
    ports: [{ name:'莫尔兹比港', col:43, row:39 }, { name:'拉包尔', col:98, row:43 }, { name:'德博因群岛', col:75, row:58 }],
    sources: [`${NHC}/1942/battle-of-coral-sea.html`, 'https://www.history.navy.mil/research/library/online-reading-room/title-list-alphabetically/b/battle-of-the-coral-sea-combat-narrative.html'],
  },
  {
    id: 'midway', title: '中途岛海战', date: '1942年6月3—6日', theater: '夏威夷西北 · 中途岛', width: 112, height: 88,
    summary: '大面积远洋搜索区以中途岛环礁为中心，周围保留广阔机动空间；岛礁本身以浅滩环和潟湖表示。',
    objective: '围绕发现敌方航母、组织舰载机出击和守住中途岛机场展开。',
    sides: ['美国特混舰队', '日本机动部队'], startingFleetIds: [
      ['fulaiche','hailunna','baerdimo','qiye','yuekecheng','dahuangfeng'],
      ['lingbo','xuefeng','changliang','miaogao','chicheng','xianghe'],
    ], starts: [{ col: 84, row: 25 }, { col: 29, row: 23 }],
    land: [
      [[.493,.485],[.501,.476],[.514,.477],[.521,.484],[.52,.494],[.514,.501],[.501,.499]],
      [[.535,.501],[.543,.495],[.552,.498],[.555,.506],[.55,.514],[.539,.513]],
      [[.20,.25],[.213,.24],[.223,.248],[.221,.26],[.21,.267],[.20,.26]],
      [[.79,.77],[.80,.764],[.809,.77],[.808,.78],[.80,.785]],
      [[.34,.72],[.348,.715],[.355,.721],[.354,.73],[.345,.733]],
    ],
    mountainRanges: [],
    reefs: [{ col:.525, row:.495, rx:.075, ry:.105, innerRx:.045, innerRy:.067 }, { col:.208,row:.253,rx:.024,ry:.03 }],
    landmarks: [
      { id:'midway-airfield', name:'中途岛海军航空站', kind:'airfield', airNation:'us', col:57, row:43, note:'沙岛与东岛机场群' },
      { id:'midway-command', name:'中途岛指挥所', kind:'field-hq', col:61, row:44, note:'东岛附近岸上设施' },
    ],
    locations: [
      { name:'中途岛环礁', col:59, row:43, kind:'land' }, { name:'沙岛', col:55, row:42, kind:'land' },
      { name:'东岛', col:61, row:44, kind:'land' }, { name:'潟湖', col:59, row:47, kind:'sea' },
      { name:'北太平洋搜索区', col:46, row:28, kind:'sea' }, { name:'航母接近海域', col:84, row:32, kind:'sea' },
    ],
    ports: [{ name:'中途岛航空站', col:57, row:43 }],
    sources: ['https://www.history.navy.mil/research/library/online-reading-room/title-list-alphabetically/b/battle-of-midway-3-6-june-1942-combat-narrative.html', 'https://www.history.navy.mil/research/archives/digital-exhibits-highlights/action-reports/wwii-battle-of-midway/commander-in-chief-pacific-fleet.html'],
  },
  {
    id: 'guadalcanal', title: '瓜达尔卡纳尔海战', date: '1942年11月12—15日', theater: '所罗门群岛 · 铁底湾', width: 112, height: 92,
    summary: '以瓜岛北岸、萨沃岛、佛罗里达群岛与铁底湾构成夜战水道，突出狭窄海峡、近距离会战和机场争夺。',
    objective: '盟军护卫舰队从南侧守住亨德森机场；日军舰队从西北进入铁底湾。',
    sides: ['盟军护卫舰队', '日本增援舰队'], startingFleetIds: [
      ['lafei','fulaiche','hailunna','kelifulan','baerdimo','huashengdun'],
      ['lingbo','xuefeng','changliang','gaoxiong','miaogao','changmen'],
    ], starts: [{ col: 62, row: 75 }, { col: 38, row: 39 }],
    land: [
      [[.12,.62],[.18,.58],[.24,.57],[.30,.59],[.36,.57],[.43,.59],[.49,.56],[.55,.58],[.61,.57],[.68,.60],[.75,.59],[.82,.61],[.89,.65],[.92,.70],[.88,.75],[.80,.78],[.73,.77],[.67,.80],[.59,.78],[.52,.81],[.45,.78],[.38,.80],[.32,.77],[.25,.78],[.19,.74],[.14,.72]],
      [[.22,.31],[.29,.29],[.36,.31],[.43,.30],[.50,.33],[.57,.31],[.64,.33],[.70,.35],[.76,.39],[.74,.43],[.67,.45],[.60,.43],[.54,.46],[.47,.43],[.40,.45],[.33,.42],[.27,.43],[.22,.39]],
      [[.28,.44],[.31,.43],[.34,.45],[.34,.49],[.31,.50],[.28,.48]],
      [[.37,.46],[.39,.45],[.41,.47],[.41,.50],[.39,.51],[.37,.49]],
      [[.86,.24],[.90,.23],[.94,.26],[.96,.32],[.94,.40],[.92,.49],[.88,.56],[.85,.52],[.86,.43],[.84,.34]],
      [[.22,.43],[.25,.42],[.27,.45],[.26,.49],[.23,.50],[.21,.47]],
      [[.04,.48],[.07,.45],[.11,.46],[.14,.50],[.13,.54],[.09,.55],[.05,.53]],
      [[.08,.24],[.14,.22],[.18,.25],[.19,.30],[.15,.33],[.10,.31]],
    ],
    mountainRanges: [
      { points: [[.17,.68],[.31,.68],[.45,.69],[.59,.68],[.74,.68],[.86,.70]], halfWidth: 3.8 },
    ],
    landmarks: [
      { id:'henderson-field', name:'亨德森机场', kind:'airfield', airNation:'us', col:59, row:57, note:'瓜岛北岸陆上航空基地' },
      { id:'tulagi-base', name:'图拉吉海军基地', kind:'seaplane-base', airNation:'jp', col:42, row:40, note:'佛罗里达岛南侧前进基地' },
      { id:'savo-command', name:'萨沃岛观测站', kind:'field-hq', col:29, row:42, note:'铁底湾西侧航道制高点' },
    ],
    locations: [
      { name:'萨沃岛', col:30, row:46, kind:'land' }, { name:'图拉吉岛', col:39, row:48, kind:'land' },
      { name:'铁底湾', col:55, row:52, kind:'sea' }, { name:'亨德森机场', col:59, row:58, kind:'land' },
      { name:'佛罗里达群岛', col:55, row:37, kind:'land' }, { name:'印迪斯彭萨布尔海峡', col:35, row:34, kind:'strait' },
    ],
    ports: [{ name:'亨德森机场岸线', col:59, row:57 }, { name:'图拉吉锚地', col:42, row:40 }],
    sources: [`${NHC}/1942/guadalcanal/naval-battle-of-guadalcanal.html`, 'https://www.history.navy.mil/content/dam/nhhc/news-and-events/multimedia%20gallery/New%20Infographics/FINAL_PART1_Guadalcanal_CruiserNightAction.pdf'],
  },
  {
    id: 'leyte-gulf', title: '莱特湾海战', date: '1944年10月23—26日', theater: '菲律宾中部 · 莱特湾与萨马岛', width: 120, height: 100,
    summary: '呈现萨马岛、莱特岛、迪纳加特岛、莱特湾及南端苏里高海峡；“萨马岛海战”作为本关主要交战区。',
    objective: '塔菲三号护航群在萨马岛以东迟滞日本中央舰队；地图也保留通往莱特湾与苏里高海峡的水道。',
    sides: ['塔菲三号护航群', '日本中央舰队'], startingFleetIds: [
      ['lafei','fulaiche','hailunna','kelifulan','qiye','yuekecheng'],
      ['lingbo','xuefeng','changliang','gaoxiong','miaogao','changmen'],
    ], starts: [{ col: 104, row: 36 }, { col: 43, row: 18 }],
    land: [
      [[.55,.02],[.61,.00],[.70,.02],[.77,.06],[.80,.11],[.77,.17],[.78,.23],[.74,.29],[.76,.34],[.73,.40],[.69,.43],[.65,.40],[.63,.34],[.61,.29],[.63,.22],[.59,.17],[.57,.11]],
      [[.39,.42],[.46,.40],[.52,.43],[.56,.48],[.57,.54],[.55,.60],[.58,.66],[.55,.72],[.57,.80],[.54,.87],[.50,.93],[.44,.98],[.39,.96],[.36,.89],[.38,.81],[.34,.73],[.36,.65],[.33,.57],[.35,.50]],
      [[.62,.54],[.66,.53],[.69,.57],[.68,.63],[.65,.67],[.62,.64]],
      [[.72,.66],[.76,.64],[.79,.67],[.78,.73],[.74,.77],[.71,.73]],
      [[.80,.74],[.83,.71],[.86,.74],[.85,.79],[.82,.82]],
      [[.12,.81],[.18,.78],[.25,.80],[.30,.85],[.31,.91],[.27,.96],[.20,.98],[.13,.94],[.10,.88]],
      [[.29,.40],[.31,.38],[.33,.41],[.32,.46],[.29,.47]],
      [[.31,.32],[.33,.30],[.35,.33],[.34,.37],[.31,.37]],
      [[.60,.43],[.62,.42],[.64,.44],[.63,.48],[.61,.49]],
    ],
    mountainRanges: [
      { points: [[.68,.06],[.68,.15],[.70,.24],[.70,.34],[.69,.40]], halfWidth: 3.4 },
      { points: [[.45,.47],[.47,.56],[.45,.66],[.47,.76],[.46,.86],[.44,.94]], halfWidth: 3.7 },
    ],
    landmarks: [
      { id:'tacloban', name:'塔克洛班机场', kind:'airfield', airNation:'us', col:53, row:51, note:'莱特岛登陆与空中支援基地' },
      { id:'samar-hq', name:'萨马岛沿岸指挥所', kind:'field-hq', col:80, row:25, note:'萨马岛以东护航航路' },
      { id:'leyte-base', name:'莱特岛登陆补给港', kind:'naval-yard', col:48, row:58, note:'莱特湾西岸盟军登陆区' },
    ],
    locations: [
      { name:'萨马岛', col:75, row:21, kind:'land' }, { name:'萨马岛海战', col:93, row:34, kind:'sea' },
      { name:'莱特湾', col:60, row:53, kind:'sea' }, { name:'莱特岛', col:48, row:74, kind:'land' },
      { name:'迪纳加特岛', col:77, row:71, kind:'land' }, { name:'苏里高海峡', col:67, row:87, kind:'strait' },
      { name:'圣贝纳迪诺海峡', col:56, row:34, kind:'strait' },
    ],
    ports: [{ name:'塔克洛班登陆场', col:53, row:51 }, { name:'萨马岛东岸', col:80, row:25 }],
    sources: [`${NHC}/1944/battle-of-leyte-gulf.html`, 'https://www.history.navy.mil/our-collections/photography/wars-and-events/world-war-ii/battle-of-leyte-gulf/battle-off-samar.html'],
  },
];

export function campaignBattle(id: string): CampaignBattle | undefined {
  return CAMPAIGN_BATTLES.find(battle => battle.id === id);
}

export function isCampaignBattleId(id: unknown): id is CampaignBattleId {
  return typeof id === 'string' && CAMPAIGN_BATTLES.some(battle => battle.id === id);
}
