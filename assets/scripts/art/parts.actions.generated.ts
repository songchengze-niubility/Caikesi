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
                    ]
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
                    ]
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
                    ]
                }
            },
            armFront: {
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
                    ]
                }
            },
            armBack: {
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
                    ]
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
                    ]
                }
            }
        }
    },
    run: {
        duration: 0.55,
        loop: true,
        parts: {
            torso: {
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
                        7.5,
                        9,
                        7.5,
                        9
                    ]
                },
                y: {
                    times: [
                        0,
                        0.125,
                        0.375,
                        0.5,
                        0.625,
                        0.875,
                        1
                    ],
                    values: [
                        0,
                        -3,
                        5,
                        0,
                        -3,
                        5,
                        0
                    ],
                    ease: "sine"
                }
            },
            head: {
                rot: {
                    times: [
                        0,
                        1
                    ],
                    values: [
                        -3.5,
                        -3.5
                    ]
                },
                y: {
                    times: [
                        0,
                        0.2,
                        0.45,
                        0.5,
                        0.7,
                        0.95,
                        1
                    ],
                    values: [
                        0,
                        -1.5,
                        2.5,
                        0.5,
                        -1.5,
                        2.5,
                        0
                    ],
                    ease: "sine"
                }
            },
            hairBack: {
                rot: {
                    times: [
                        0,
                        0.2,
                        0.45,
                        0.7,
                        0.95,
                        1
                    ],
                    values: [
                        -4,
                        -12,
                        -6,
                        -12,
                        -4.6,
                        -4
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
                        -26,
                        6,
                        28,
                        4,
                        -26
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
                        28,
                        4,
                        -26,
                        6,
                        28
                    ],
                    ease: "sine"
                }
            },
            armBack: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        -20,
                        -2,
                        16,
                        -2,
                        -20
                    ],
                    ease: "sine"
                }
            },
            armFront: {
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
                        20,
                        16,
                        20,
                        16
                    ],
                    ease: "sine"
                }
            },
            weapon: {
                rot: {
                    times: [
                        0,
                        0.25,
                        0.5,
                        0.75,
                        1
                    ],
                    values: [
                        78,
                        81,
                        78,
                        81,
                        78
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
            armFront: {
                rot: {
                    times: [
                        0,
                        0.16,
                        0.3,
                        0.44,
                        0.58,
                        0.8,
                        1
                    ],
                    values: [
                        0,
                        -45,
                        -80,
                        -25,
                        50,
                        15,
                        0
                    ],
                    ease: "quadOut"
                }
            },
            weapon: {
                rot: {
                    times: [
                        0,
                        0.16,
                        0.3,
                        0.44,
                        0.58,
                        0.8,
                        1
                    ],
                    values: [
                        0,
                        -18,
                        -32,
                        -8,
                        22,
                        7,
                        0
                    ],
                    ease: "quadOut"
                }
            },
            torso: {
                x: {
                    times: [
                        0,
                        0.3,
                        0.52,
                        0.78,
                        1
                    ],
                    values: [
                        0,
                        -3,
                        12,
                        4,
                        0
                    ],
                    ease: "quadOut"
                }
            },
            head: {
                rot: {
                    times: [
                        0,
                        0.3,
                        0.55,
                        1
                    ],
                    values: [
                        0,
                        -4,
                        3.5,
                        0
                    ]
                }
            },
            hairBack: {
                rot: {
                    times: [
                        0,
                        0.35,
                        0.62,
                        1
                    ],
                    values: [
                        0,
                        6,
                        -9,
                        0
                    ]
                }
            },
            legFront: {
                rot: {
                    times: [
                        0,
                        0.3,
                        0.55,
                        1
                    ],
                    values: [
                        0,
                        -6,
                        9,
                        0
                    ]
                }
            },
            armBack: {
                rot: {
                    times: [
                        0,
                        0.3,
                        0.55,
                        1
                    ],
                    values: [
                        0,
                        10,
                        -12,
                        0
                    ]
                }
            }
        }
    },
    death: {
        duration: 0.6,
        loop: false,
        root: {
            rot: {
                times: [
                    0,
                    0.7,
                    0.88,
                    1
                ],
                values: [
                    0,
                    78,
                    87,
                    85
                ],
                ease: "quadIn"
            },
            opacity: {
                times: [
                    0,
                    0.5,
                    1
                ],
                values: [
                    1,
                    0.92,
                    0.55
                ]
            },
            y: {
                times: [
                    0,
                    0.85,
                    1
                ],
                values: [
                    0,
                    2,
                    0
                ],
                ease: "quadOut"
            }
        },
        parts: {
            hairBack: {
                rot: {
                    times: [
                        0,
                        1
                    ],
                    values: [
                        0,
                        12
                    ]
                }
            },
            armFront: {
                rot: {
                    times: [
                        0,
                        1
                    ],
                    values: [
                        0,
                        10
                    ]
                }
            },
            armBack: {
                rot: {
                    times: [
                        0,
                        1
                    ],
                    values: [
                        0,
                        -8
                    ]
                }
            },
            weapon: {
                rot: {
                    times: [
                        0,
                        0.8,
                        1
                    ],
                    values: [
                        0,
                        20,
                        22
                    ],
                    ease: "quadOut"
                }
            }
        }
    }
};
