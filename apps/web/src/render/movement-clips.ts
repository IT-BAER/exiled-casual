import {
  AbstractMesh,
  Animation,
  AnimationGroup,
  Matrix,
  Quaternion,
  TransformNode,
  Vector3,
  type IAnimationKey,
  type Node,
  type Scene,
} from "@babylonjs/core";

type Gait = "walk" | "run";

export type MovementKeyframeSpec = { name: string; gait: Gait; yaw: number; stride: number };

export const MOVEMENT_PACE: Readonly<Record<Gait, number>> = { walk: 1.55, run: 3.8 };

/** Bake rate of the clips: fine enough for a heel kick that lasts a few frames. */
const BAKE_FPS = 60;
const SECOND_FOOT = 0.5;
/** A swinging ankle stays this far (legs) off the floor, or it would drag where its keys dip. */
const SWING_CLEARANCE = 0.01;
const RIGHT = Vector3.Right();
const UP = Vector3.Up();
const FORWARD = Vector3.Forward();

/** Values at equally spaced phases of the stride (phase 0 = left foot down ahead), wrapping. */
export type Loop = readonly number[];

export interface ArmKeys {
  /** The wrist off its own shoulder in arm lengths, in the body's frame: ahead, up, outward. */
  fwd: Loop;
  up: Loop;
  out: Loop;
  /** Where the elbow points while it bends: outward and backward. */
  elbowOut: number;
  elbowBack: number;
  /** Hand pitch off the forearm, radians. */
  wrist: Loop;
  /** Hand roll about the forearm after the pitch, radians; absent, none. It turns the held weapon. */
  roll?: Loop;
  /** Collarbone raise and forward roll, radians. */
  clavLift: Loop;
  clavFwd: Loop;
}

/**
 * One gait as authored keys. Distances are in leg lengths (thigh to ankle), angles in radians.
 * The left leg runs the stride from phase 0, the right half a stride later on the same keys.
 */
export interface GaitKeys {
  /** Seconds per stride at `MOVEMENT_PACE`. */
  period: number;
  /** Share of the stride a foot is planted. */
  stance: number;
  /** Share of the planted travel the foot lands ahead of its hip. */
  reach: number;
  /** Ankle outward of its rest line while planted. */
  width: number;
  /** Swing travel from lift-off (0) to touchdown (1), inner keys over the swing. */
  swingAlong: readonly number[];
  /** Ankle outward during the swing, inner keys (0 at both ends). */
  swingOut: readonly number[];
  /** Ankle height in the swing, keyed over the whole stride; a planted heel rises with `footPitch`. */
  height: Loop;
  /** Foot pitch off its rest, over the whole stride; the ankle rises if the ball would sink. */
  footPitch: Loop;
  /** Knee pole outward of straight ahead (tangent), over each foot's own stride; absent, the knee bends straight ahead. */
  kneeOut?: Loop;
  hipHeight: Loop;
  hipSway: Loop;
  hipYaw: Loop;
  hipRoll: Loop;
  hipPitch: Loop;
  /** Lower spine (spine_02): forward lean, twist, bank. */
  lean: Loop;
  twist: Loop;
  bank: Loop;
  /** Upper spine (spine_03). */
  chestLean: Loop;
  chestTwist: Loop;
  headYaw: Loop;
  /** The fit scores the nod mean-removed, so its mean is set by hand to PoE2's absolute head pitch. */
  headNod: Loop;
  arms: readonly [left: ArmKeys, right: ArmKeys];
}

const zeros = (n: number): Loop => Array.from({ length: n }, () => 0);
const wave = (n: number, amp: number, phase = 0, mean = 0): Loop =>
  Array.from({ length: n }, (_, i) => mean + amp * Math.cos(2 * Math.PI * (i / n - phase)));

function arm(side: 0 | 1, swing: number, ahead: number, height: number): ArmKeys {
  const half = side * SECOND_FOOT;
  return {
    fwd: wave(8, swing, 0.5 + half, ahead), up: wave(8, swing * 0.3, 0.5 + half, height), out: wave(8, 0, 0, 0.2),
    elbowOut: 0.4, elbowBack: 1, wrist: zeros(6), clavLift: zeros(6), clavFwd: zeros(6),
  };
}

/**
 * Both gaits are fitted to measured gait traits of PoE2's unarmed run and walk. The run's legs and
 * hips follow the `_01` takes alone: wand, sword and bow runs share that leg layer, and averaging in
 * the `_02` takes, which drop the trailing foot early, flattens the heel kick. The run's swing overshoots
 * (`swingAlong` past 1) so the foot reaches furthest ahead in the air and lands pulling back, as PoE2's
 * does. Every fit also matches PoE2's side sway, trunk side lean and pelvis yaw: unfitted, the hip and
 * trunk keys fill those with a left-right shake.
 */
export const GAITS: Readonly<Record<Gait, GaitKeys>> = {
  walk: {
    period: 1.101,
    stance: 0.5641,
    reach: 0.4404,
    width: -0.0295,
    swingAlong: [0.0444, 0.1734, 0.3609, 0.5405, 0.7772, 0.8644],
    swingOut: [0.0184, 0.0064, 0.0102, -0.0194],
    height: [0.0259, 0.0108, -0.2925, 0.052, -0.0299, 0.086, 0.2113, 0.1158],
    footPitch: [-0.3566, -0.0905, -0.0447, -0.0225, 0.7147, 1.2757, 0.8974, 0.3283],
    hipHeight: [-0.0532, -0.0803, -0.0488, -0.0064, -0.0198, -0.0899, -0.0434, -0.0049],
    hipSway: [-0.0238, -0.0538, -0.066, -0.0567, -0.0263, -0.0027, -0.0011, -0.0237],
    hipYaw: [0.1484, 0.0641, -0.118, -0.1535, -0.1466, -0.0525, 0.1144, 0.1467],
    hipRoll: [0.0148, -0.0117, 0.009, 0.0079, 0.0004, -0.0011, -0.0001, -0.0037],
    hipPitch: [0.0033, 0.0215, 0.0375, 0.0183, 0.0453, 0.0422, 0.0297, -0.0138],
    lean: [0.2438, 0.2603, 0.2245, 0.2196, 0.2117, 0.2336, 0.229, 0.2387],
    twist: [0.0905, -0.3125, 0.08, 0.0469, -0.0282, 0.075, 0.0099, 0.0016],
    bank: [-0.0396, -0.0166, 0.0303, 0.0228, 0.0315, 0.0144, -0.0374, -0.0399],
    chestLean: [0.0183, 0.0128, 0.005, 0.0259, 0.026, 0.0002, 0.0045, 0.0228],
    chestTwist: [-0.3044, 0.1505, -0.016, 0.1148, 0.205, 0.0547, -0.0439, -0.1303],
    headYaw: [0.0395, 0.0804, 0.0504, 0.0123, -0.0019, -0.0588, -0.0748, -0.0343],
    headNod: [-0.0187, 0.0062, 0.0728, 0.0302, -0.0355, 0.0218, 0.0754, 0.0424],
    arms: [
      { fwd: [0.0231, 0.0965, 0.2609, 0.3592, 0.3205, 0.1875, 0.0275, -0.0103], up: [-0.8829, -0.8981, -0.8614, -0.8153, -0.8236, -0.8544, -0.8825, -0.8895], out: [0.318, 0.2917, 0.2569, 0.2102, 0.1833, 0.2557, 0.3351, 0.333],
        elbowOut: 0.1587, elbowBack: 1.7255, wrist: [0.0127, -0.0109, 0.0626, -0.0211, -0.0389, 0.0264], clavLift: [0.0504, -0.0432, -0.0281, -0.0312, -0.0129, 0.065], clavFwd: [0.1111, 0.0035, -0.0982, -0.1497, -0.0044, 0.1319] },
      { fwd: [0.3013, 0.1626, 0.0542, 0.0649, 0.0757, 0.1202, 0.2579, 0.3371], up: [-0.7707, -0.8212, -0.8397, -0.8237, -0.8151, -0.8353, -0.7936, -0.7539], out: [0.1739, 0.2534, 0.3178, 0.3234, 0.314, 0.2842, 0.2439, 0.1957],
        elbowOut: -0.2433, elbowBack: 0.9575, wrist: [-0.0676, -0.0735, -0.0439, -0.0728, -0.0832, -0.0601], clavLift: [0.0006, 0.0013, -0.0014, -0.0029, 0.0027, 0.0002], clavFwd: [-0.1258, -0.0009, 0.1034, 0.1743, 0.01, -0.1561] },
    ],
  },
  run: {
    period: 0.8329,
    stance: 0.2661,
    reach: 0.37,
    width: -0.1258,
    swingAlong: [-0.248, -0.1801, 0.1141, 0.5146, 0.8819, 1.1018],
    swingOut: [0.0672, 0.1656, 0.1752, 0.062],
    height: [0.2369, 0.062, 0.0077, -0.0925, 0.158, 0.4699, 0.6129, 0.7595, 0.6267, 0.3455, 0.3571, 0.2853],
    footPitch: [-0.1616, 0.0487, 0.112, 1.0107, 1.4972, 1.819, 2.1262, 2.2196, 1.8583, 0.6638, 0.0044, -0.3255],
    hipHeight: [-0.0066, -0.0901, -0.0107, 0.0204, -0.0057, -0.0885, -0.0016, 0.0138],
    hipSway: [-0.0023, 0.01, 0.0086, -0.0237, -0.0383, -0.0493, -0.039, -0.0169],
    hipYaw: [0.1811, 0.0567, -0.148, -0.1607, -0.177, -0.0575, 0.1379, 0.1602],
    hipRoll: [0.0793, 0.0362, 0.063, 0.0413, -0.0406, -0.0318, -0.1076, -0.0395],
    hipPitch: [0.1497, 0.1197, 0.1155, 0.2015, 0.221, 0.1502, 0.1563, 0.1995],
    lean: [0.3809, 0.3944, 0.4075, 0.2244, 0.2093, 0.3319, 0.3612, 0.2354],
    twist: [-0.1804, -0.152, 0.3087, 0.372, 0.2349, 0.1871, -0.3975, -0.3677],
    bank: [-0.2435, -0.0029, 0.176, 0.1424, 0.1473, -0.0061, -0.0945, -0.151],
    chestLean: [0.0215, 0.033, 0.0567, 0.1202, 0.0655, 0.0691, 0.0042, 0.096],
    chestTwist: [-0.3072, 0.0289, 0.1263, 0.2186, 0.2745, -0.07, -0.0244, -0.2117],
    headYaw: [0.3179, 0.1725, -0.1436, -0.294, -0.2889, -0.1643, 0.0988, 0.2857],
    headNod: [-0.0381, -0.0267, -0.1313, -0.131, 0.0075, -0.0292, -0.087, -0.115],
    arms: [
      { fwd: [-0.3273, 0.0039, 0.3697, 0.2362, 0.149, 0.1566, -0.1453, -0.2136], up: [-0.7758, -0.8987, -0.61, -0.4715, -0.4785, -0.7047, -0.8076, -0.7446], out: [0.1986, 0.1669, -0.0834, -0.1932, -0.1605, 0.1247, 0.2948, 0.2437],
        elbowOut: 1.1437, elbowBack: 1.9182, wrist: [0.0084, 0.0108, 0.01, 0.0086, 0.0098, 0.0086], clavLift: [0.0997, -0.0462, -0.0961, -0.1497, 0.007, 0.1791], clavFwd: [-0.0327, 0.0416, -0.0037, -0.0382, 0.0402, -0.0085] },
      { fwd: [0.1579, 0.08, -0.0825, -0.1787, -0.2536, -0.0385, 0.2524, 0.225], up: [-0.7293, -0.8016, -0.8461, -0.8248, -0.8348, -0.8968, -0.7814, -0.7282], out: [0.0388, 0.1916, 0.2614, 0.2282, 0.1785, 0.1483, 0.0393, -0.0133],
        elbowOut: 1.4181, elbowBack: 0.8376, wrist: [-0.2873, -0.2247, -0.2459, -0.2339, -0.2408, -0.34], roll: [-0.269, -0.1688, -0.0156, 0.0192, -0.4716, -0.6943], clavLift: [-0.0051, 0.0044, 0.0045, -0.0036, 0.0061, -0.0073], clavFwd: [-0.0235, 0.0457, 0.0389, -0.0028, 0.0004, -0.056] },
    ],
  },
};

/**
 * The bow carry: each gait's own legs, with the bow arm held forward and low, the draw hand by the
 * chest and the shoulders turned toward the bow, fitted to PoE2's bow runs and walks. The bow walk also
 * keeps its own hips and head: PoE2's bow walk sways and turns them unlike the unarmed walk.
 */
export const BOW_GAITS: Readonly<Record<Gait, GaitKeys>> = {
  walk: {
    ...GAITS.walk,
    hipSway: [-0.012, -0.0417, -0.065, -0.0677, -0.0576, -0.0361, -0.0165, -0.0051],
    hipYaw: [0.0294, -0.0715, -0.2468, -0.2878, -0.2786, -0.1818, -0.0068, 0.0307],
    hipRoll: [0.0082, 0.0104, 0.0075, 0.0218, 0.0403, -0.0156, 0.0057, -0.0326],
    bank: [0.0659, 0.1253, 0.1811, 0.1331, 0.0962, 0.1197, 0.0292, 0.1041],
    twist: [-0.0005, 0.14, 0.4, 0.3984, 0.389, 0.0076, -0.0863, -0.1242],
    chestLean: [0.1012, 0.0671, 0.0788, 0.0554, 0.0529, 0.0221, 0.0406, 0.0869],
    chestTwist: [-0.4, -0.4, -0.3684, -0.1869, -0.105, 0.1122, -0.0879, -0.229],
    headYaw: [0.0763, 0.0306, -0.0662, -0.171, -0.2412, -0.1891, -0.068, 0.0341],
    headNod: [0.0037, 0.0075, 0.0456, 0.0294, -0.0438, -0.0031, 0.0476, 0.0264],
    arms: [
      { fwd: [0.4737, 0.4741, 0.4911, 0.4964, 0.4442, 0.4398, 0.4673, 0.4994], up: [-0.7962, -0.8072, -0.7967, -0.7812, -0.7825, -0.8162, -0.8228, -0.8041], out: [-0.1078, -0.1359, -0.1801, -0.2135, -0.2458, -0.1882, -0.1149, -0.0791],
        elbowOut: -0.005, elbowBack: 0.2006, wrist: [0.0241, 0.0313, 0.0263, 0.0811, 0.034, 0.032], clavLift: [-0.3861, -0.4371, -0.4032, -0.4138, -0.4421, -0.3791], clavFwd: [-0.5, -0.5, -0.4882, -0.4298, -0.4418, -0.4944] },
      { fwd: [0.3132, 0.3225, 0.377, 0.4373, 0.4328, 0.397, 0.3644, 0.3423], up: [-0.5763, -0.6168, -0.6354, -0.6235, -0.6021, -0.6334, -0.6289, -0.6016], out: [-0.1945, -0.1715, -0.136, -0.1099, -0.0661, -0.1174, -0.1873, -0.2272],
        elbowOut: 0.5025, elbowBack: 1.5633, wrist: [-0.1338, 0.0001, 0.0627, -0.0188, 0.0488, 0.012], clavLift: [-0.4578, -0.4764, -0.4963, -0.4998, -0.498, -0.4817], clavFwd: [0.5, 0.5, 0.4648, 0.4273, 0.4472, 0.4938] },
    ],
  },
  run: {
    ...GAITS.run,
    twist: [-0.266, -0.225, 0.2517, 0.3978, 0.2095, 0.1261, -0.4, -0.4],
    chestLean: [0.0224, 0.0492, 0.0396, 0.1576, 0.0709, 0.0995, 0.0096, 0.147],
    chestTwist: [-0.2426, 0.0939, 0.1654, 0.1542, 0.2895, -0.0179, -0.0364, -0.183],
    arms: [
      { fwd: [0.3721, 0.4423, 0.4537, 0.373, 0.3026, 0.4048, 0.4936, 0.4253], up: [-0.85, -0.7713, -0.6674, -0.6468, -0.6833, -0.7272, -0.7602, -0.8277], out: [-0.1001, -0.2496, -0.4231, -0.5107, -0.5211, -0.3995, -0.2248, -0.1144],
        elbowOut: -0.0303, elbowBack: 1.8264, wrist: [-0.0, 0.0, -0.0, 0.0, -0.0001, 0.0001], clavLift: [-0.2097, -0.1928, -0.2429, -0.3072, -0.3138, -0.322], clavFwd: [-0.4996, -0.247, -0.1352, -0.2669, -0.4444, -0.5] },
      { fwd: [0.221, 0.3194, 0.4091, 0.3791, 0.3268, 0.3762, 0.3504, 0.2716], up: [-0.5737, -0.5793, -0.5389, -0.5551, -0.6132, -0.5742, -0.5492, -0.5901], out: [-0.2288, -0.1375, 0.018, 0.0819, 0.1102, -0.0125, -0.138, -0.2224],
        elbowOut: 0.2862, elbowBack: 0.3348, wrist: [-0.0477, 0.0017, -0.0366, 0.0959, -0.0672, -0.0389], clavLift: [-0.0236, -0.0275, -0.0323, -0.0356, -0.0308, -0.0254], clavFwd: [0.4758, 0.3617, 0.2901, 0.2988, 0.4895, 0.5] },
    ],
  },
};

/**
 * A backpedal's own keys, for every clip travelling behind the hips' side line. The forward keys played
 * backwards lean the trunk back 20 degrees, swing the arms against PoE2's and kick the heel up in front.
 * Fitted to PoE2's wand and sword unarmed backpedals (`_bwd_01`) with each trunk loop held to two stride
 * harmonics: free, the waist lean, twist, bank and hip roll cancel each other and the chest jitters sideways.
 */
export const BACK_GAITS: Readonly<Partial<Record<Gait, GaitKeys>>> = {
  run: {
    period: 0.8888,
    stance: 0.2589,
    reach: 0.5114,
    width: -0.0913,
    swingAlong: [-0.2954, -0.2037, 0.1988, 0.8303, 1.2395, 1.1704],
    swingOut: [0.0528, 0.1908, 0.1387, 0.0298],
    height: [0.2121, -0.0247, 0.043, 0.0031, 0.2181, 0.3013, 0.2995, 0.4456, 0.5452, 0.5252, 0.5206, 0.3971],
    footPitch: [0.7756, 0.3519, 0.3826, 0.2929, 0.2017, 0.2904, 0.6832, 1.3751, 1.9009, 1.8432, 1.5962, 1.7886],
    hipHeight: [0.016, -0.0351, 0.0858, 0.0637, 0.0229, -0.0339, 0.081, 0.0547],
    hipSway: [-0.0361, -0.0172, -0.0147, -0.0142, -0.0323, -0.0632, -0.0865, -0.0649],
    hipYaw: [-0.1552, -0.0126, 0.1043, 0.1553, 0.169, 0.0201, -0.1353, -0.1636],
    hipRoll: [0.0307, 0.0719, 0.1211, 0.0474, -0.0107, -0.0517, -0.0879, -0.028],
    hipPitch: [-0.1798, -0.1255, -0.1701, -0.3099, -0.3998, -0.2306, -0.1054, -0.1534],
    lean: [-0.0936, -0.2936, -0.1846, 0.3262, 0.4681, 0.017, -0.3031, -0.1474],
    twist: [0.2839, 0.0014, -0.2822, -0.391, -0.2828, 0.0181, 0.291, 0.3898],
    bank: [-0.0936, -0.0063, 0.0235, -0.0014, -0.0127, -0.0271, -0.1283, -0.1556],
    chestLean: [0.3044, 0.5208, 0.479, 0.0892, -0.0347, 0.2963, 0.4976, 0.3528],
    chestTwist: [0.1663, -0.0107, -0.1753, -0.2575, -0.2134, -0.0172, 0.1752, 0.2368],
    headYaw: [-0.2888, -0.0535, 0.248, 0.4147, 0.3053, 0.0452, -0.2627, -0.4119],
    headNod: [0.164, 0.129, 0.2282, 0.2238, 0.1708, 0.1444, 0.2502, 0.2346],
    arms: [
      { fwd: [0.4354, 0.3904, 0.1, 0.184, 0.206, 0.4803, 0.5286, 0.4034], up: [-0.2936, -0.6958, -0.8154, -0.7381, -0.7853, -0.7064, -0.3656, -0.2945], out: [-0.1833, 0.1101, 0.253, 0.2908, 0.3619, 0.2312, -0.1325, -0.2044],
        elbowOut: 0.106, elbowBack: 0.2001, wrist: [-0.0233, -0.0074, -0.0073, -0.0069, -0.0174, -0.0353], clavLift: [-0.1351, 0.0574, 0.1881, 0.0529, -0.063, -0.1193], clavFwd: [0.0043, 0.0448, 0.0233, 0.0184, -0.0527, -0.0205] },
      { fwd: [0.288, 0.4084, 0.5167, 0.5449, 0.5427, 0.3676, 0.1893, 0.2499], up: [-0.784, -0.7573, -0.6058, -0.519, -0.5282, -0.7682, -0.8368, -0.7914], out: [0.3352, 0.2433, 0.0369, -0.0425, -0.0419, 0.1165, 0.2208, 0.2791],
        elbowOut: -0.2857, elbowBack: 1.1122, wrist: [-0.068, -0.0782, -0.1298, -0.0936, -0.0615, -0.09], roll: [0.1477, -0.1765, -0.4083, -0.1137, 0.284, 0.4152], clavLift: [0.003, 0.0035, -0.0041, 0.0026, -0.0044, -0.0005], clavFwd: [0.0631, -0.0527, -0.0664, -0.0284, 0.0346, 0.036] },
    ],
    kneeOut: [0.0008, 0.0014, 0.0049, -0.0001, -0.0016, -0.0008, 0.0015, 0.0004],
  },
};

/** The bow carry over a backpedal: the backpedal's legs with the bow held, upper body fitted to PoE2's `run_bow_bwd_01`. */
export const BOW_BACK_GAITS: Readonly<Partial<Record<Gait, GaitKeys>>> = {
  run: {
    ...BACK_GAITS.run!,
    twist: [0.3063, 0.0216, -0.22, -0.2497, -0.1483, 0.0979, 0.3166, 0.4],
    chestLean: [0.2468, 0.4499, 0.4687, 0.137, -0.0086, 0.2906, 0.5028, 0.3524],
    chestTwist: [0.2226, 0.1746, 0.059, -0.1182, -0.2123, -0.0887, 0.0709, 0.1573],
    headYaw: [-0.3724, -0.25, -0.0282, 0.1414, 0.1731, 0.0283, -0.1971, -0.3502],
    arms: [
      { fwd: [0.7128, 0.7617, 0.7719, 0.8079, 0.8142, 0.7391, 0.6901, 0.6969], up: [-0.1694, -0.3246, -0.4505, -0.4379, -0.421, -0.4425, -0.3672, -0.2192], out: [-0.5469, -0.4184, -0.2777, -0.1827, -0.1627, -0.3221, -0.4633, -0.5345],
        elbowOut: -0.0062, elbowBack: 1.3616, wrist: [-0.0004, -0.0002, -0.0004, 0.0001, -0.0005, 0.0002], clavLift: [-0.4679, -0.4187, -0.3123, -0.2053, -0.383, -0.4997], clavFwd: [-0.4851, -0.4689, -0.4997, -0.4142, -0.4985, -0.4439] },
      { fwd: [0.6789, 0.602, 0.4886, 0.454, 0.4363, 0.5028, 0.5703, 0.6499], up: [-0.3007, -0.3709, -0.4266, -0.3661, -0.3149, -0.3775, -0.3662, -0.3086], out: [0.1438, -0.0112, -0.131, -0.217, -0.2363, -0.1372, 0.0142, 0.103],
        elbowOut: -0.2711, elbowBack: 0.5728, wrist: [0.0387, 0.106, 0.0033, -0.108, -0.1256, -0.0304], clavLift: [0.3029, 0.2903, 0.2888, 0.2925, 0.2977, 0.2968], clavFwd: [0.145, 0.0715, 0.1689, 0.1266, 0.1279, 0.0642] },
    ],
  },
};

/**
 * Keys for a back diagonal (the 110-degree clips), fitted to PoE2's `_bwd_left_01`: its feet cross mostly
 * sideways under a turned body, which neither the backpedal nor the forward keys can say.
 */
export const BACK_DIAG_GAITS: Readonly<Partial<Record<Gait, GaitKeys>>> = {
  run: {
    period: 0.7755,
    stance: 0.2589,
    reach: 0.5119,
    width: -0.0881,
    swingAlong: [-0.3165, -0.2942, 0.1843, 0.8656, 1.1984, 1.1801],
    swingOut: [0.0979, 0.0531, -0.0672, -0.0369],
    height: [0.2605, -0.2748, -0.2573, 0.0194, 0.3361, 0.3885, 0.3484, 0.357, 0.4111, 0.4006, 0.4891, 0.4319],
    footPitch: [0.8336, -0.0762, -0.0613, -0.1042, 0.1487, 0.1239, 0.2552, 0.5711, 1.2972, 1.504, 1.4086, 1.0773],
    hipHeight: [-0.0184, -0.1001, -0.0658, 0.1126, -0.0012, -0.0831, -0.0034, 0.0332],
    hipSway: [0.0258, 0.0266, 0.0436, 0.0155, 0.0038, -0.0069, -0.0031, 0.0179],
    hipYaw: [-0.0995, 0.0162, 0.1233, 0.1447, 0.1785, 0.0841, -0.0488, -0.0938],
    hipRoll: [0.2488, 0.2733, 0.3256, 0.3226, 0.2617, 0.1264, 0.0241, 0.118],
    hipPitch: [0.0751, 0.073, 0.0377, -0.1492, -0.2334, -0.1765, -0.047, 0.0471],
    lean: [-0.4587, -0.4041, -0.177, 0.108, 0.255, 0.1837, -0.0543, -0.3114],
    twist: [-0.0487, 0.124, 0.2619, 0.2828, 0.1853, 0.0607, -0.0597, -0.1154],
    bank: [-0.0558, -0.1285, -0.1996, -0.2124, -0.1475, -0.003, 0.1475, 0.0945],
    chestLean: [0.7079, 0.5506, 0.2435, 0.1404, 0.1984, 0.22, 0.3142, 0.5501],
    chestTwist: [0.054, 0.0798, 0.183, 0.3092, 0.2861, 0.1359, 0.0231, 0.0239],
    headYaw: [0.3892, 0.2252, -0.0107, -0.1823, -0.186, -0.0107, 0.2932, 0.4419],
    headNod: [-0.0435, 0.1341, 0.1579, 0.1032, 0.1017, 0.1245, -0.0018, -0.1127],
    arms: [
      { fwd: [-0.0204, 0.3302, 0.5123, 0.3201, 0.2615, 0.4068, 0.1764, 0.086], up: [-0.8614, -0.8513, -0.4082, -0.3313, -0.3666, -0.6217, -0.8408, -0.7958], out: [0.1108, -0.0175, -0.2685, -0.3166, -0.2735, -0.0333, 0.1499, 0.1291],
        elbowOut: 0.1765, elbowBack: 0.2, wrist: [0.0003, 0.0006, 0.0029, 0.0019, 0.0005, 0.0002], clavLift: [0.0433, -0.0961, -0.0822, -0.0557, 0.0274, 0.1496], clavFwd: [0.0225, 0.0158, -0.0593, -0.0724, 0.0078, 0.0079] },
      { fwd: [0.3701, 0.2637, 0.1101, 0.0264, -0.0149, 0.2279, 0.48, 0.4446], up: [-0.5918, -0.6663, -0.747, -0.7692, -0.8198, -0.7937, -0.5936, -0.5738], out: [0.2668, 0.4233, 0.4697, 0.4135, 0.3508, 0.3811, 0.2928, 0.2282],
        elbowOut: -0.1492, elbowBack: 1.6329, wrist: [-0.0308, -0.0141, -0.0417, -0.0264, -0.0118, -0.053], roll: [-0.1571, -0.0515, 0.1795, 0.0746, -0.3987, -0.5068], clavLift: [-0.0109, 0.0087, 0.0154, 0.01, -0.0054, -0.0135], clavFwd: [-0.0336, -0.0068, 0.0237, 0.0725, 0.0375, -0.015] },
    ],
    kneeOut: [0.0008, -0.0002, -0.0002, -0.0001, -0.0001, -0.0004, 0.0004, 0.001],
  },
};
export const BOW_BACK_DIAG_GAITS: Readonly<Partial<Record<Gait, GaitKeys>>> = {
  run: {
    ...BACK_DIAG_GAITS.run!,
    twist: [-0.097, 0.0528, 0.1356, 0.0455, -0.0559, -0.0489, -0.0584, -0.1182],
    chestLean: [0.7666, 0.6164, 0.3315, 0.2499, 0.2855, 0.2695, 0.3496, 0.5944],
    chestTwist: [-0.0898, -0.1713, -0.0967, 0.112, 0.1999, 0.0807, -0.0375, -0.0351],
    headYaw: [0.4942, 0.3856, 0.2285, 0.1058, 0.0023, 0.0696, 0.3052, 0.4546],
    arms: [
      { fwd: [0.6039, 0.6673, 0.6879, 0.6217, 0.5855, 0.6878, 0.7414, 0.6676], up: [-0.7055, -0.5932, -0.4438, -0.4324, -0.4812, -0.491, -0.5349, -0.6521], out: [-0.0861, -0.2362, -0.3993, -0.4942, -0.5068, -0.3735, -0.1951, -0.0942],
        elbowOut: 0.0018, elbowBack: 1.7107, wrist: [0.0006, 0.0006, 0.0004, 0.0009, 0.0006, 0.0006], clavLift: [-0.3085, -0.3366, -0.3918, -0.33, -0.3573, -0.3944], clavFwd: [-0.4835, -0.483, -0.4574, -0.5, -0.4856, -0.5] },
      { fwd: [0.3551, 0.4561, 0.554, 0.5532, 0.5456, 0.5582, 0.4923, 0.4125], up: [-0.4877, -0.4699, -0.3769, -0.379, -0.4312, -0.3934, -0.4221, -0.4851], out: [-0.2358, -0.1473, -0.0086, 0.0599, 0.0911, -0.041, -0.156, -0.2335],
        elbowOut: -0.2816, elbowBack: 0.2879, wrist: [0.1527, 0.0788, -0.0722, 0.1241, -0.0417, 0.0247], clavLift: [0.2128, 0.226, 0.2257, 0.2345, 0.2275, 0.2064], clavFwd: [0.1196, 0.0687, 0.0472, 0.1554, 0.1573, 0.2009] },
    ],
  },
};
/** The right back diagonal, fitted to `_bwd_right_01`: PoE2's is no mirror of its left (mirrored, it scores 144). */
export const BACK_DIAG_RIGHT_GAITS: Readonly<Partial<Record<Gait, GaitKeys>>> = {
  run: {
    period: 0.7168,
    stance: 0.2514,
    reach: 0.527,
    width: -0.0532,
    swingAlong: [-0.0572, -0.0641, 0.4626, 0.6366, 0.8667, 1.0253],
    swingOut: [0.174, 0.0669, -0.2499, -0.1777],
    height: [0.2293, 0.4663, -0.2561, 0.0254, 0.2311, 0.3291, 0.2828, 0.3791, 0.4849, 0.5113, 0.5112, 0.4323],
    footPitch: [0.7974, -0.0758, 0.0007, 0.3518, 0.3963, 0.5486, 0.5456, 0.7216, 1.0047, 0.8648, 0.6263, 1.1194],
    hipHeight: [-0.0176, -0.1078, -0.0525, 0.0298, -0.0191, -0.0817, 0.0188, 0.0122],
    hipSway: [0.0121, 0.0234, 0.0117, -0.01, -0.0257, -0.0189, -0.0229, -0.0054],
    hipYaw: [-0.3027, -0.2407, -0.1417, -0.0754, -0.0559, -0.1431, -0.2383, -0.271],
    hipRoll: [-0.363, -0.183, -0.0142, -0.1152, -0.2646, -0.2671, -0.3086, -0.3745],
    hipPitch: [-0.3844, -0.2867, -0.1291, -0.0236, -0.014, -0.088, -0.177, -0.3142],
    lean: [0.5833, 0.4395, 0.1164, -0.1723, -0.17, 0.0399, 0.3029, 0.4893],
    twist: [-0.18, 0.0195, 0.1967, 0.3048, 0.2172, -0.0835, -0.3561, -0.3625],
    bank: [0.3065, 0.1216, -0.1438, -0.1275, 0.0459, 0.1155, 0.1425, 0.2437],
    chestLean: [0.0601, 0.1364, 0.3193, 0.5471, 0.6158, 0.394, 0.1584, 0.0321],
    chestTwist: [-0.2658, -0.1188, 0.0094, -0.0325, -0.0643, -0.012, -0.056, -0.2137],
    headYaw: [0.0782, -0.0862, -0.4255, -0.6316, -0.5708, -0.3771, -0.0942, 0.0822],
    headNod: [0.2449, 0.2665, 0.085, 0.0087, 0.0733, 0.2357, 0.2199, 0.1966],
    arms: [
      { fwd: [-0.0936, 0.2661, 0.543, 0.3916, 0.3089, 0.2984, 0.0134, -0.0314], up: [-0.8168, -0.7998, -0.4418, -0.3972, -0.4251, -0.6119, -0.7573, -0.733], out: [0.2803, 0.3531, 0.0942, -0.0496, -0.0362, 0.2987, 0.4297, 0.3456],
        elbowOut: 0.0819, elbowBack: 0.2255, wrist: [0.0047, 0.007, -0.0387, 0.1191, 0.0135, 0.0091], clavLift: [0.0284, -0.059, -0.0268, -0.043, -0.0076, 0.0848], clavFwd: [0.0151, -0.0172, 0.0045, 0.0025, 0.0337, 0.0032] },
      { fwd: [0.4776, 0.4127, 0.2365, 0.1279, 0.0486, 0.2759, 0.5173, 0.4968], up: [-0.5736, -0.713, -0.8341, -0.8378, -0.8692, -0.8633, -0.6315, -0.5678], out: [-0.0423, 0.1268, 0.1975, 0.2118, 0.193, 0.0831, -0.0556, -0.0962],
        elbowOut: 0.9394, elbowBack: 0.2268, wrist: [-0.0494, -0.0013, -0.0318, -0.0114, -0.0082, 0.1553], roll: [-0.6132, -0.4423, -0.2794, -0.3108, -0.7989, -0.867], clavLift: [-0.0012, 0.0005, 0.0026, 0.0044, -0.0033, -0.0065], clavFwd: [-0.0409, 0.0419, 0.0054, -0.0045, -0.0139, -0.0227] },
    ],
    kneeOut: [0.3693, 0.1371, 0.2221, 0.2782, 0.1942, 0.4228, 0.475, 0.4893],
  },
};
export const BOW_BACK_DIAG_RIGHT_GAITS: Readonly<Partial<Record<Gait, GaitKeys>>> = {
  run: {
    ...BACK_DIAG_RIGHT_GAITS.run!,
    twist: [-0.2068, -0.0149, 0.157, 0.2605, 0.1942, -0.0923, -0.3762, -0.3849],
    chestLean: [0.0578, 0.1341, 0.3176, 0.5403, 0.6109, 0.3963, 0.1604, 0.034],
    chestTwist: [-0.2103, -0.1344, -0.0613, -0.1292, -0.1131, 0.0074, 0.015, -0.1149],
    headYaw: [0.1805, 0.0601, -0.249, -0.4206, -0.3994, -0.2437, -0.0057, 0.1325],
    arms: [
      { fwd: [0.5436, 0.671, 0.7505, 0.7257, 0.6841, 0.7076, 0.692, 0.5866], up: [-0.6493, -0.5776, -0.5095, -0.5392, -0.6011, -0.5825, -0.5504, -0.6151], out: [0.391, 0.263, 0.0801, -0.0281, -0.0416, 0.1175, 0.3036, 0.3958],
        elbowOut: 0.0406, elbowBack: 0.2049, wrist: [-0.0027, -0.0035, -0.0032, -0.0031, -0.0047, -0.0048], clavLift: [-0.2277, -0.2301, -0.2655, -0.2445, -0.3184, -0.3587], clavFwd: [-0.0918, -0.001, 0.0829, -0.0227, -0.1248, -0.2097] },
      { fwd: [0.1728, 0.3138, 0.4646, 0.4751, 0.4559, 0.4223, 0.3326, 0.2225], up: [-0.4067, -0.3937, -0.3469, -0.3909, -0.4687, -0.3911, -0.3599, -0.4011], out: [-0.4939, -0.4639, -0.356, -0.2984, -0.2802, -0.3903, -0.4703, -0.52],
        elbowOut: -0.8171, elbowBack: 0.7633, wrist: [0.063, 0.08, 0.0148, 0.0879, -0.0191, 0.0266], clavLift: [0.1233, 0.116, 0.1096, 0.108, 0.1115, 0.1181], clavFwd: [-0.0031, -0.0766, -0.1647, -0.0871, 0.0455, 0.1433] },
    ],
  },
};

const halfOn = (v: Loop): Loop => [...v.slice(v.length / 2), ...v.slice(0, v.length / 2)];

/**
 * The same gait moving to the other side: the body half a stride on (each foot does what the other did),
 * every sideways and yaw loop negated, the arms swapped. The legs' own keys stay: the move mirrors them.
 */
export function mirrorKeys(keys: GaitKeys): GaitKeys {
  const flip = (v: Loop): Loop => halfOn(v).map((x) => -x);
  return {
    ...keys,
    hipHeight: halfOn(keys.hipHeight), hipPitch: halfOn(keys.hipPitch), lean: halfOn(keys.lean),
    chestLean: halfOn(keys.chestLean), headNod: halfOn(keys.headNod),
    hipSway: flip(keys.hipSway), hipYaw: flip(keys.hipYaw), hipRoll: flip(keys.hipRoll), twist: flip(keys.twist),
    bank: flip(keys.bank), chestTwist: flip(keys.chestTwist), headYaw: flip(keys.headYaw),
    arms: [mirrorArm(keys.arms[1]), mirrorArm(keys.arms[0])],
  };
}

/** An arm's keys for the other side: `out`, the elbow pole and the collarbone already read outward per side. */
function mirrorArm(a: ArmKeys): ArmKeys {
  return { ...a, fwd: halfOn(a.fwd), up: halfOn(a.up), out: halfOn(a.out), wrist: halfOn(a.wrist),
    clavLift: halfOn(a.clavLift), clavFwd: halfOn(a.clavFwd) };
}

/** Off-facing angle past which a clip takes the backpedal's keys, not the back diagonal's: midway between 110 and 180. */
const BACK_FROM = (145 * Math.PI) / 180;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** A wrapping key loop at `phase`, Catmull-Rom between keys. */
export function loop(keys: Loop, phase: number): number {
  const n = keys.length;
  const x = (((phase % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const k = (j: number) => keys[(((i + j) % n) + n) % n]!;
  return catmull(k(-1), k(0), k(1), k(2), x - i);
}

/** Inner keys between fixed ends `from` and `to` over 0..1, Catmull-Rom, ends held. */
export function span(inner: readonly number[], s: number, from: number, to: number): number {
  const keys = [from, ...inner, to];
  const n = keys.length - 1;
  const x = Math.min(1, Math.max(0, s)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const k = (j: number) => keys[Math.min(n, Math.max(0, i + j))]!;
  return catmull(k(-1), k(0), k(1), k(2), x - i);
}

function freshWorld(node: TransformNode): void {
  if (node.parent instanceof TransformNode) freshWorld(node.parent);
  node.computeWorldMatrix(true);
}

function toParent(node: TransformNode, pivotWorld: Matrix): Matrix {
  const parent = node.parent;
  return parent instanceof TransformNode
    ? pivotWorld.multiply(parent.getWorldMatrix().clone().invert())
    : pivotWorld;
}

function swing(node: TransformNode, current: Vector3, wanted: Vector3, pivotWorld: Matrix): void {
  const transform = toParent(node, pivotWorld);
  const from = Vector3.TransformNormal(current, transform).normalize();
  const to = Vector3.TransformNormal(wanted, transform).normalize();
  const rotation = node.rotationQuaternion!;
  Quaternion.FromUnitVectorsToRef(from, to, new Quaternion()).multiplyToRef(rotation, rotation);
}

function turn(node: TransformNode, axis: Vector3, angle: number, pivotWorld: Matrix): void {
  if (angle === 0) return;
  const transform = toParent(node, pivotWorld);
  const local = Vector3.TransformNormal(axis, transform).normalize();
  // Mapping an angular axis through the imported armature's reflection reverses its sense.
  const rotation = node.rotationQuaternion!;
  Quaternion.RotationAxis(local, angle * Math.sign(transform.determinant())).multiplyToRef(rotation, rotation);
}

type Position = (node: TransformNode) => Vector3;

/** Two-bone IK: `end` onto `target`, the middle joint bending toward `pole`. */
function reachTo(root: TransformNode, mid: TransformNode, end: TransformNode, target: Vector3, pole: Vector3, pivotWorld: Matrix, position: Position): void {
  const base = position(root);
  const upper = Vector3.Distance(base, position(mid));
  const lower = Vector3.Distance(position(mid), position(end));
  const reach = target.subtract(base);
  const length = Math.max(Math.abs(upper - lower) + 1e-5, Math.min(0.998 * (upper + lower), reach.length()));
  const toward = reach.normalize();
  let bend = pole.subtract(toward.scale(Vector3.Dot(pole, toward)));
  if (bend.lengthSquared() < 1e-10) bend = FORWARD.subtract(toward.scale(Vector3.Dot(FORWARD, toward)));
  bend.normalize();
  const along = (upper * upper + length * length - lower * lower) / (2 * length);
  const joint = base.add(toward.scale(along)).addInPlace(bend.scale(Math.sqrt(Math.max(0, upper * upper - along * along))));
  swing(root, position(mid).subtract(base), joint.subtract(base), pivotWorld);
  root.computeWorldMatrix(true);
  mid.computeWorldMatrix(true);
  end.computeWorldMatrix(true);
  const midNow = position(mid);
  swing(mid, position(end).subtract(midNow), target.subtract(midNow), pivotWorld);
  mid.computeWorldMatrix(true);
  end.computeWorldMatrix(true);
}

interface Leg {
  thigh: TransformNode;
  calf: TransformNode;
  foot: TransformNode;
  ball: TransformNode;
  anchor: Vector3;
  ballRest: number;
  /** Ball off the ankle at rest. */
  toe: Vector3;
  /** The sole's heel off the ankle at rest, in the forward/up plane. */
  heel: Vector3;
  bindBasis: Matrix;
  side: number;
}

interface Arm {
  clavicle: TransformNode;
  shoulder: TransformNode;
  elbow: TransformNode;
  hand: TransformNode;
  length: number;
  side: number;
}

/**
 * The sole's heel off the ankle, as shares of the ankle-to-ball offset: back along it and down
 * under it. Measured off all three boots on both bodies (0.10-0.12 m back, 0.08-0.10 m down).
 */
export const HEEL_BACK = 0.8;
export const HEEL_DOWN = 1.4;

/**
 * The ankle's rise and lead over its track when the foot pitches about a contact that stays put:
 * toe-down about the ball, toe-up about the heel, so a heel strike lifts the ankle instead of
 * sinking the heel through the floor.
 */
function heelRise(leg: Leg, pitch: number): Vector3 {
  const c = Math.cos(pitch), s = Math.sin(pitch), { y, z } = pitch >= 0 ? leg.toe : leg.heel;
  return new Vector3(0, y * (1 - c) + z * s, z * (1 - c) - y * s);
}

interface FootGoal {
  ankle: Vector3;
  /** Where a planted ball stays while the heel rises, or null. */
  ball: Vector3 | null;
  pitch: number;
  /** Where the knee bends toward, in the body's frame. */
  pole: Vector3;
}

function footTarget(leg: Leg, lane: number, q: number, keys: GaitKeys, distance: number, travel: Vector3, ahead: number, legLength: number): FootGoal {
  const planted = q < keys.stance;
  const s = (q - keys.stance) / (1 - keys.stance);
  const along = planted ? keys.reach - q / keys.stance : keys.reach - 1 + span(keys.swingAlong, s, 0, 1);
  const at = leg.anchor.add(travel.scale(along * distance));
  // The swing leaves and meets the stance on the floor: the loop's own values at both ends are taken
  // off along it, or the foot pops up at toe-off and drops at touchdown within a frame.
  if (!planted) {
    const lift = loop(keys.height, q) - (1 - s) * loop(keys.height, keys.stance) - s * loop(keys.height, 1);
    at.y += Math.max(SWING_CLEARANCE * 4 * s * (1 - s), lift) * legLength;
  }
  at.x += leg.side * (keys.width + (planted ? 0 : span(keys.swingOut, s, 0, 0))) * legLength;
  // Feet step wide of each other on a strafe instead of crossing.
  const reach = 2 * legLength;
  at.x += leg.side * reach * Math.abs(travel.x) * 0.045;
  at.z += lane * reach * Math.abs(travel.x) * 0.06;
  const scale = Math.max(0.35, ahead);
  const pitch = loop(keys.footPitch, q) * scale;
  const pole = keys.kneeOut ? new Vector3(leg.side * loop(keys.kneeOut, q), 0, 1) : FORWARD;
  if (planted) return { ankle: at.add(heelRise(leg, pitch)), ball: pitch > 0 ? at.add(leg.toe) : null, pitch, pole };
  // The heel lifted at toe-off fades out over the swing and the heel strike's lift fades in, so the
  // ankle leaves and meets the planted track without a jump.
  const lifted = heelRise(leg, loop(keys.footPitch, keys.stance) * scale).scale((1 - s) ** 2);
  // A toe-first landing (a backpedal's) plants on the ball: its lift comes in over the swing's last sixth,
  // or it reshapes the whole swing the keys were fitted on.
  const striking = heelRise(leg, Math.min(0, pitch)).scale(s * s)
    .addInPlace(heelRise(leg, Math.max(0, loop(keys.footPitch, 0) * scale)).scale(s ** 10));
  return { ankle: at.add(lifted).addInPlace(striking), ball: null, pitch, pole };
}

function placeFoot(leg: Leg, { ankle, ball, pitch, pole }: FootGoal, pivotWorld: Matrix, position: Position): void {
  let target = ankle;
  for (let pass = 0; pass < 4; pass++) {
    reachTo(leg.thigh, leg.calf, leg.foot, target, pole, pivotWorld, position);
    leg.bindBasis.multiply(Matrix.RotationX(pitch)).multiply(toParent(leg.foot, pivotWorld))
      .decompose(undefined, leg.foot.rotationQuaternion!);
    leg.foot.computeWorldMatrix(true);
    leg.ball.computeWorldMatrix(true);
    const at = position(leg.ball);
    const fix = new Vector3(ball ? ball.x - at.x : 0, Math.max(0, leg.ballRest - at.y), ball ? ball.z - at.z : 0);
    if (fix.lengthSquared() <= 1e-10) return;
    target = target.add(fix);
  }
}

function motionTrack(name: string, property: string, type: number, frames: number, keys: IAnimationKey[], target: TransformNode, group: AnimationGroup): void {
  const animation = new Animation(`${name}-${target.name}-${property}`, property, BAKE_FPS, type, Animation.ANIMATIONLOOPMODE_CYCLE);
  const first = keys[0]!.value as Quaternion | Vector3;
  keys.push({ frame: frames, value: first.clone() });
  animation.setKeys(keys);
  group.addTargetedAnimation(animation, target);
}

/** Bake original in-place movement against the attached body's bind proportions. */
export function createMovementClips(
  scene: Scene,
  pivot: TransformNode,
  bones: ReadonlyMap<string, Node>,
  specs: readonly MovementKeyframeSpec[],
  gaits: Readonly<Record<Gait, GaitKeys>> = GAITS,
  backGaits: Readonly<Partial<Record<Gait, GaitKeys>>> = BACK_GAITS,
  diagGaits: Readonly<Partial<Record<Gait, GaitKeys>>> = BACK_DIAG_GAITS,
  diagRightGaits: Readonly<Partial<Record<Gait, GaitKeys>>> = BACK_DIAG_RIGHT_GAITS,
): Map<string, AnimationGroup> | null {
  function joint(name: string): TransformNode | null {
    const node = bones.get(name);
    return node instanceof TransformNode && node.rotationQuaternion && !(node instanceof AbstractMesh) ? node : null;
  }

  const pelvis = joint("pelvis");
  const spine = joint("spine_02");
  const chest = joint("spine_03");
  const head = joint("Head");
  if (!pelvis || !spine || !chest || !head) return null;
  freshWorld(pivot);
  const pivotWorld = pivot.getWorldMatrix().clone();
  const inverse = pivotWorld.clone().invert();
  const position: Position = (node) => Vector3.TransformCoordinates(node.getAbsolutePosition(), inverse);
  freshWorld(pelvis);
  const centre = position(pelvis).x;
  const legs: Leg[] = [];
  const arms: Arm[] = [];
  for (const side of ["l", "r"]) {
    const thigh = joint(`thigh_${side}`), calf = joint(`calf_${side}`), foot = joint(`foot_${side}`), ball = joint(`ball_${side}`);
    const clavicle = joint(`clavicle_${side}`), shoulder = joint(`upperarm_${side}`), elbow = joint(`lowerarm_${side}`), hand = joint(`hand_${side}`);
    if (!thigh || !calf || !foot || !ball || !clavicle || !shoulder || !elbow || !hand) return null;
    freshWorld(ball);
    freshWorld(hand);
    const outward = Math.sign(position(thigh).x - centre) || (side === "l" ? 1 : -1);
    const toe = position(ball).subtract(position(foot));
    const heel = new Vector3(0, HEEL_DOWN * toe.y, -HEEL_BACK * toe.z);
    legs.push({ thigh, calf, foot, ball, anchor: position(foot), ballRest: position(ball).y, toe, heel, bindBasis: foot.getWorldMatrix().multiply(inverse), side: outward });
    const length = Vector3.Distance(position(shoulder), position(elbow)) + Vector3.Distance(position(elbow), position(hand));
    arms.push({ clavicle, shoulder, elbow, hand, length, side: Math.sign(position(shoulder).x - centre) || outward });
  }
  const legLength = legs.reduce((sum, { thigh, calf, foot }) =>
    sum + Vector3.Distance(position(thigh), position(calf)) + Vector3.Distance(position(calf), position(foot)), 0) / 2;
  if (!(legLength > 1e-4)) return null;

  // The waist and neck are held at bind: unkeyed, they keep whatever the clip before left them,
  // and the idle's neck sits 27 degrees off it, which turns the head's yaw and nod off their fit.
  const held = ["spine_01", "neck_01"].map(joint).filter((node): node is TransformNode => node !== null);
  const keyed = [pelvis, spine, chest, head, ...held,
    ...legs.flatMap(({ thigh, calf, foot }) => [thigh, calf, foot]),
    ...arms.flatMap(({ clavicle, shoulder, elbow, hand }) => [clavicle, shoulder, elbow, hand])];
  const saved = keyed.map((node) => node.rotationQuaternion!.clone());
  const pelvisRest = pelvis.position.clone();
  const pelvisToParent = toParent(pelvis, pivotWorld);
  const groups = new Map<string, AnimationGroup>();
  const rest = () => {
    for (const [i, node] of keyed.entries()) node.rotationQuaternion!.copyFrom(saved[i]!);
    pelvis.position.copyFrom(pelvisRest);
    for (const node of keyed) freshWorld(node);
  };

  try {
    for (const spec of specs) {
      if (groups.has(spec.name) || !Number.isFinite(spec.yaw) || !(spec.stride > 0) || !Number.isFinite(spec.stride)) {
        throw new Error(`Invalid movement clip ${spec.name}`);
      }
      const travel = new Vector3(Math.sin(spec.yaw), 0, Math.cos(spec.yaw));
      const off = Math.abs(Math.atan2(travel.x, travel.z));
      const diagonal = off <= BACK_FROM && off > Math.PI / 2;
      const right = travel.x > 0;
      const diag = diagonal ? (right ? diagRightGaits : diagGaits)[spec.gait] : undefined;
      // A gait with no right back-diagonal keys plays the left one's mirror.
      const mirrored = diagonal && right && diag === undefined && diagGaits[spec.gait] !== undefined;
      const own = off > BACK_FROM ? backGaits[spec.gait] : mirrored ? mirrorKeys(diagGaits[spec.gait]!) : diag;
      const keys = own ?? gaits[spec.gait];
      // Right back-diagonal keys, fitted or mirrored, lead with the other foot.
      const lane = diagonal && right ? -1 : 1;
      const frames = Math.max(8, Math.round(keys.period * BAKE_FPS));
      // Keys fitted at their own direction play their lean and foot pitch whole; the forward keys scale them down off it.
      const ahead = own ? 1 : travel.z;
      const distance = keys.period * keys.stance * MOVEMENT_PACE[spec.gait] * spec.stride;
      const rotations: IAnimationKey[][] = keyed.map(() => []);
      const translations: IAnimationKey[] = [];
      for (let frame = 0; frame < frames; frame++) {
        rest();
        const phase = frame / frames;
        turn(pelvis, UP, loop(keys.hipYaw, phase), pivotWorld);
        turn(pelvis, FORWARD, loop(keys.hipRoll, phase), pivotWorld);
        turn(pelvis, RIGHT, loop(keys.hipPitch, phase) * ahead, pivotWorld);
        pelvis.computeWorldMatrix(true);
        const feet = legs.map((leg, i) => footTarget(leg, (i === 0 ? 1 : -1) * lane, (phase + SECOND_FOOT * i) % 1, keys, distance, travel, ahead, legLength));
        const shift = new Vector3(loop(keys.hipSway, phase) * legLength, loop(keys.hipHeight, phase) * legLength, 0);
        for (const [i, leg] of legs.entries()) {
          leg.thigh.computeWorldMatrix(true);
          const hip = position(leg.thigh);
          const target = feet[i]!.ankle;
          const dx = target.x - hip.x - shift.x, dz = target.z - hip.z;
          const reach = Vector3.Distance(hip, position(leg.calf)) + Vector3.Distance(position(leg.calf), position(leg.foot));
          const below = Math.sqrt(Math.max(0, (0.995 * reach) ** 2 - dx * dx - dz * dz));
          shift.y = Math.min(shift.y, target.y + below - hip.y);
        }
        pelvis.position.copyFrom(pelvisRest).addInPlace(Vector3.TransformNormal(shift, pelvisToParent));
        pelvis.computeWorldMatrix(true);
        for (const [i, leg] of legs.entries()) {
          freshWorld(leg.foot);
          placeFoot(leg, feet[i]!, pivotWorld, position);
        }
        freshWorld(spine);
        turn(spine, RIGHT, loop(keys.lean, phase) * ahead, pivotWorld);
        turn(spine, UP, loop(keys.twist, phase), pivotWorld);
        turn(spine, FORWARD, loop(keys.bank, phase), pivotWorld);
        freshWorld(chest);
        turn(chest, RIGHT, loop(keys.chestLean, phase) * ahead, pivotWorld);
        turn(chest, UP, loop(keys.chestTwist, phase), pivotWorld);
        freshWorld(head);
        turn(head, UP, loop(keys.headYaw, phase), pivotWorld);
        turn(head, RIGHT, loop(keys.headNod, phase), pivotWorld);
        for (const [i, limb] of arms.entries()) {
          const a = keys.arms[i]!;
          freshWorld(limb.clavicle);
          turn(limb.clavicle, FORWARD, limb.side * loop(a.clavLift, phase), pivotWorld);
          turn(limb.clavicle, UP, limb.side * loop(a.clavFwd, phase), pivotWorld);
          freshWorld(limb.hand);
          const wrist = position(limb.shoulder).add(new Vector3(limb.side * loop(a.out, phase), loop(a.up, phase), loop(a.fwd, phase)).scale(limb.length));
          reachTo(limb.shoulder, limb.elbow, limb.hand, wrist, new Vector3(limb.side * a.elbowOut, 0, -a.elbowBack), pivotWorld, position);
          turn(limb.hand, RIGHT, loop(a.wrist, phase), pivotWorld);
          if (a.roll) turn(limb.hand, position(limb.hand).subtract(position(limb.elbow)).normalize(), limb.side * loop(a.roll, phase), pivotWorld);
        }
        for (const [i, node] of keyed.entries()) rotations[i]!.push({ frame, value: node.rotationQuaternion!.clone() });
        translations.push({ frame, value: pelvis.position.clone() });
      }

      const group = new AnimationGroup(spec.name, scene);
      groups.set(spec.name, group);
      for (const [i, node] of keyed.entries()) {
        motionTrack(spec.name, "rotationQuaternion", Animation.ANIMATIONTYPE_QUATERNION, frames, rotations[i]!, node, group);
      }
      motionTrack(spec.name, "position", Animation.ANIMATIONTYPE_VECTOR3, frames, translations, pelvis, group);
      group.normalize(0, frames);
    }
    return groups;
  } catch {
    for (const group of groups.values()) group.dispose();
    return null;
  } finally {
    rest();
  }
}
