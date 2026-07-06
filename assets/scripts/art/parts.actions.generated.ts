// 动作参数产物（勿手改）：真源=PartsRig 动作编辑器（npm run rig:editor 生成页面，导出 JSON 后 npm run rig:import 回写）
// 标准骨架全角色共享；个别角色差异化时再扩 per-character 覆盖
import type { RigActionDef, RigActionId } from './PartsRigConfig';

export const PartsRigActions: Record<RigActionId, RigActionDef> = {
    idle: {
        duration: 1.2,
        loop: true,
        parts: {
            torso: {
                scaleY: {
                    times: [
                        0,
                        0.5,
                        1
                    ],
                    values: [
                        1,
                        1.018,
                        1
                    ],
                    ease: "sine"
                }
            },
            head: {
                y: {
                    times: [
                        0,
                        0.55,
                        1
                    ],
                    values: [
                        0,
                        2,
                        0
                    ],
                    ease: "sine"
                }
            },
            hairBack: {
                rot: {
                    times: [
                        0,
                        0.6,
                        1
                    ],
                    values: [
                        -2,
                        2.5,
                        -2
                    ],
                    ease: "sine"
                }
            },
            robeFront: {
                rot: {
                    times: [
                        0,
                        0.5,
                        1
                    ],
                    values: [
                        0,
                        1.5,
                        0
                    ],
                    ease: "sine"
                }
            },
            robeBack: {
                rot: {
                    times: [
                        0,
                        0.6,
                        1
                    ],
                    values: [
                        0,
                        -2,
                        0
                    ],
                    ease: "sine"
                }
            },
            armFrontUpper: {
                rot: {
                    times: [
                        0,
                        0.5,
                        1
                    ],
                    values: [
                        0,
                        2,
                        0
                    ],
                    ease: "sine"
                }
            },
            armFrontLower: {
                rot: {
                    times: [
                        0,
                        0.55,
                        1
                    ],
                    values: [
                        0,
                        1.5,
                        0
                    ],
                    ease: "sine"
                }
            },
            armBackUpper: {
                rot: {
                    times: [
                        0,
                        0.5,
                        1
                    ],
                    values: [
                        0,
                        -2,
                        0
                    ],
                    ease: "sine"
                }
            },
            armBackLower: {
                rot: {
                    times: [
                        0,
                        0.55,
                        1
                    ],
                    values: [
                        0,
                        -1.5,
                        0
                    ],
                    ease: "sine"
                }
            },
            weapon: {
                rot: {
                    times: [
                        0,
                        0.5,
                        1
                    ],
                    values: [
                        0,
                        -1.5,
                        0
                    ],
                    ease: "sine"
                }
            }
        }
    },
    run: {
        duration: 0.5,
        loop: true,
        parts: {
            torso: {
                rot: {
                    times: [
                        0,
                        1
                    ],
                    values: [
                        8,
                        8
                    ]
                },
                y: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        0,
                        4,
                        0,
                        4,
                        0
                    ],
                    ease: "sine"
                }
            },
            head: {
                y: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        0,
                        -2,
                        0,
                        -2,
                        0
                    ],
                    ease: "sine"
                }
            },
            hairBack: {
                rot: {
                    times: [
                        0,
                        0.5,
                        1
                    ],
                    values: [
                        12,
                        -5,
                        12
                    ],
                    ease: "sine"
                }
            },
            legFront: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        22,
                        0,
                        -22,
                        0,
                        22
                    ],
                    ease: "sine"
                }
            },
            legBack: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        -22,
                        0,
                        22,
                        0,
                        -22
                    ],
                    ease: "sine"
                }
            },
            robeFront: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        9,
                        0,
                        -9,
                        0,
                        9
                    ],
                    ease: "sine"
                }
            },
            robeBack: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        -9,
                        0,
                        9,
                        0,
                        -9
                    ],
                    ease: "sine"
                }
            },
            armFrontUpper: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        -16,
                        0,
                        16,
                        0,
                        -16
                    ],
                    ease: "sine"
                }
            },
            armFrontLower: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        -8,
                        0,
                        8,
                        0,
                        -8
                    ],
                    ease: "sine"
                }
            },
            armBackUpper: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        16,
                        0,
                        -16,
                        0,
                        16
                    ],
                    ease: "sine"
                }
            },
            armBackLower: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        8,
                        0,
                        -8,
                        0,
                        8
                    ],
                    ease: "sine"
                }
            }
        }
    },
    attack: {
        duration: 0.35,
        loop: false,
        parts: {
            armFrontUpper: {
                rot: {
                    times: [
                        0,
                        0.35,
                        0.6,
                        0.85,
                        1
                    ],
                    values: [
                        0,
                        -80,
                        25,
                        5,
                        0
                    ],
                    ease: "quadOut"
                }
            },
            armFrontLower: {
                rot: {
                    times: [
                        0,
                        0.4,
                        0.65,
                        0.9,
                        1
                    ],
                    values: [
                        0,
                        -25,
                        14,
                        3,
                        0
                    ],
                    ease: "quadOut"
                }
            },
            weapon: {
                rot: {
                    times: [
                        0,
                        0.42,
                        0.66,
                        0.9,
                        1
                    ],
                    values: [
                        0,
                        -15,
                        16,
                        2,
                        0
                    ],
                    ease: "quadOut"
                }
            },
            torso: {
                x: {
                    times: [
                        0,
                        0.35,
                        0.6,
                        1
                    ],
                    values: [
                        0,
                        -4,
                        12,
                        0
                    ],
                    ease: "quadOut"
                },
                rot: {
                    times: [
                        0,
                        0.35,
                        0.6,
                        1
                    ],
                    values: [
                        0,
                        -3,
                        6,
                        0
                    ],
                    ease: "quadOut"
                }
            },
            robeFront: {
                rot: {
                    times: [
                        0,
                        0.45,
                        0.7,
                        1
                    ],
                    values: [
                        0,
                        5,
                        -7,
                        0
                    ],
                    ease: "sine"
                }
            },
            robeBack: {
                rot: {
                    times: [
                        0,
                        0.45,
                        0.7,
                        1
                    ],
                    values: [
                        0,
                        -6,
                        8,
                        0
                    ],
                    ease: "sine"
                }
            },
            hairBack: {
                rot: {
                    times: [
                        0,
                        0.4,
                        0.7,
                        1
                    ],
                    values: [
                        0,
                        8,
                        -10,
                        0
                    ],
                    ease: "sine"
                }
            },
            head: {
                rot: {
                    times: [
                        0,
                        0.35,
                        0.6,
                        1
                    ],
                    values: [
                        0,
                        -2,
                        3,
                        0
                    ],
                    ease: "sine"
                }
            }
        }
    },
    death: {
        duration: 0.6,
        loop: false,
        parts: {},
        root: {
            rot: {
                times: [
                    0,
                    0.5,
                    0.8,
                    1
                ],
                values: [
                    0,
                    70,
                    88,
                    85
                ],
                ease: "quadOut"
            },
            opacity: {
                times: [
                    0,
                    0.6,
                    1
                ],
                values: [
                    1,
                    1,
                    0.4
                ]
            }
        }
    }
};
