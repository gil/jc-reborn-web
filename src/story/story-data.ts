// Scene flags
export const FINAL       = 0x01;
export const FIRST       = 0x02;
export const ISLAND      = 0x04;
export const LEFT_ISLAND = 0x08;
export const VARPOS_OK   = 0x10;
export const LOWTIDE_OK  = 0x20;
export const NORAFT      = 0x40;
export const HOLIDAY_NOK = 0x80;

// Spots
export const SPOT_A = 0, SPOT_B = 1, SPOT_C = 2, SPOT_D = 3, SPOT_E = 4, SPOT_F = 5;

// Headings
export const HDG_S = 0, HDG_SW = 1, HDG_W = 2, HDG_NW = 3, HDG_N = 4, HDG_NE = 5, HDG_E = 6, HDG_SE = 7;

export interface StoryScene {
  adsName: string;
  adsTagNo: number;
  spotStart: number;
  hdgStart: number;
  spotEnd: number;
  hdgEnd: number;
  dayNo: number;
  flags: number;
}

export const storyScenes: StoryScene[] = [
  { adsName: 'ACTIVITY.ADS', adsTagNo:  1, spotStart: SPOT_E, hdgStart: HDG_SE, spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK                              },
  { adsName: 'ACTIVITY.ADS', adsTagNo: 12, spotStart: SPOT_D, hdgStart: HDG_SW, spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK | LOWTIDE_OK                  },
  { adsName: 'ACTIVITY.ADS', adsTagNo: 11, spotStart: 0,      hdgStart: 0,      spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | FIRST | VARPOS_OK                       },
  { adsName: 'ACTIVITY.ADS', adsTagNo: 10, spotStart: SPOT_D, hdgStart: HDG_SW, spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK | LOWTIDE_OK                  },
  { adsName: 'ACTIVITY.ADS', adsTagNo:  4, spotStart: SPOT_E, hdgStart: HDG_SE, spotEnd: SPOT_E, hdgEnd: HDG_SE, dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'ACTIVITY.ADS', adsTagNo:  5, spotStart: SPOT_E, hdgStart: HDG_SW, spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK | LOWTIDE_OK                  },
  { adsName: 'ACTIVITY.ADS', adsTagNo:  6, spotStart: SPOT_D, hdgStart: HDG_SW, spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK                               },
  { adsName: 'ACTIVITY.ADS', adsTagNo:  7, spotStart: SPOT_D, hdgStart: HDG_SW, spotEnd: SPOT_F, hdgEnd: HDG_SW, dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'ACTIVITY.ADS', adsTagNo:  8, spotStart: 0,      hdgStart: 0,      spotEnd: SPOT_D, hdgEnd: HDG_SE, dayNo: 0, flags: ISLAND | FIRST | VARPOS_OK                               },
  { adsName: 'ACTIVITY.ADS', adsTagNo:  9, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | LOWTIDE_OK                              },

  { adsName: 'BUILDING.ADS', adsTagNo:  1, spotStart: SPOT_F, hdgStart: HDG_W,  spotEnd: SPOT_A, hdgEnd: HDG_W,  dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'BUILDING.ADS', adsTagNo:  4, spotStart: SPOT_A, hdgStart: HDG_E,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK                               },
  { adsName: 'BUILDING.ADS', adsTagNo:  3, spotStart: SPOT_A, hdgStart: HDG_E,  spotEnd: SPOT_C, hdgEnd: HDG_SE, dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'BUILDING.ADS', adsTagNo:  2, spotStart: SPOT_F, hdgStart: HDG_W,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK                               },
  { adsName: 'BUILDING.ADS', adsTagNo:  5, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: SPOT_D, hdgEnd: HDG_E,  dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'BUILDING.ADS', adsTagNo:  7, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: SPOT_D, hdgEnd: HDG_E,  dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'BUILDING.ADS', adsTagNo:  6, spotStart: SPOT_A, hdgStart: HDG_E,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK                               },

  { adsName: 'FISHING.ADS',  adsTagNo:  1, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: SPOT_D, hdgEnd: HDG_E,  dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'FISHING.ADS',  adsTagNo:  2, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: SPOT_D, hdgEnd: HDG_E,  dayNo: 0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                          },
  { adsName: 'FISHING.ADS',  adsTagNo:  3, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK | LOWTIDE_OK                  },
  { adsName: 'FISHING.ADS',  adsTagNo:  4, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | LEFT_ISLAND | LOWTIDE_OK                },
  { adsName: 'FISHING.ADS',  adsTagNo:  5, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | VARPOS_OK                               },
  { adsName: 'FISHING.ADS',  adsTagNo:  6, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: 0,      hdgEnd: 0,      dayNo: 0, flags: ISLAND | FINAL | LOWTIDE_OK                              },
  { adsName: 'FISHING.ADS',  adsTagNo:  7, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: SPOT_E, hdgEnd: HDG_W,  dayNo: 0, flags: ISLAND | LEFT_ISLAND | VARPOS_OK | LOWTIDE_OK            },
  { adsName: 'FISHING.ADS',  adsTagNo:  8, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: SPOT_E, hdgEnd: HDG_W,  dayNo: 0, flags: ISLAND | LEFT_ISLAND | VARPOS_OK | LOWTIDE_OK            },

  { adsName: 'JOHNNY.ADS',   adsTagNo:  1, spotStart: 0,      hdgStart: 0,      spotEnd: 0,      hdgEnd: 0,      dayNo: 11, flags: FINAL | FIRST                                           },
  { adsName: 'JOHNNY.ADS',   adsTagNo:  2, spotStart: SPOT_E, hdgStart: HDG_SW, spotEnd: SPOT_F, hdgEnd: 0,      dayNo:  2, flags: ISLAND | FINAL | VARPOS_OK                              },
  { adsName: 'JOHNNY.ADS',   adsTagNo:  3, spotStart: SPOT_E, hdgStart: HDG_SW, spotEnd: SPOT_F, hdgEnd: HDG_NE, dayNo:  6, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'JOHNNY.ADS',   adsTagNo:  4, spotStart: SPOT_E, hdgStart: HDG_SW, spotEnd: SPOT_F, hdgEnd: HDG_NE, dayNo:  0, flags: ISLAND | VARPOS_OK                                      },
  { adsName: 'JOHNNY.ADS',   adsTagNo:  5, spotStart: SPOT_E, hdgStart: HDG_SW, spotEnd: SPOT_F, hdgEnd: HDG_NE, dayNo:  0, flags: ISLAND | VARPOS_OK                                      },
  { adsName: 'JOHNNY.ADS',   adsTagNo:  6, spotStart: 0,      hdgStart: 0,      spotEnd: 0,      hdgEnd: 0,      dayNo: 10, flags: FINAL | FIRST                                           },

  { adsName: 'MARY.ADS',     adsTagNo:  1, spotStart: SPOT_E, hdgStart: HDG_SW, spotEnd: 0,      hdgEnd: 0,      dayNo:  5, flags: ISLAND | FINAL | VARPOS_OK | LOWTIDE_OK                 },
  { adsName: 'MARY.ADS',     adsTagNo:  3, spotStart: SPOT_F, hdgStart: HDG_SW, spotEnd: 0,      hdgEnd: 0,      dayNo:  4, flags: ISLAND | FINAL | FIRST | VARPOS_OK                      },
  { adsName: 'MARY.ADS',     adsTagNo:  2, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: 0,      hdgEnd: 0,      dayNo:  1, flags: ISLAND | FINAL | VARPOS_OK                              },
  { adsName: 'MARY.ADS',     adsTagNo:  4, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: 0,      hdgEnd: 0,      dayNo:  7, flags: ISLAND | FINAL | VARPOS_OK                              },
  { adsName: 'MARY.ADS',     adsTagNo:  5, spotStart: SPOT_E, hdgStart: HDG_NW, spotEnd: 0,      hdgEnd: 0,      dayNo:  8, flags: ISLAND | LEFT_ISLAND | FINAL | FIRST | NORAFT | VARPOS_OK },

  { adsName: 'MISCGAG.ADS',  adsTagNo:  1, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: 0,      hdgEnd: 0,      dayNo:  0, flags: ISLAND | FINAL | VARPOS_OK | LOWTIDE_OK                 },
  { adsName: 'MISCGAG.ADS',  adsTagNo:  2, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: 0,      hdgEnd: 0,      dayNo:  0, flags: ISLAND | FINAL | VARPOS_OK                              },

  { adsName: 'STAND.ADS',    adsTagNo:  1, spotStart: SPOT_A, hdgStart: HDG_SW, spotEnd: SPOT_A, hdgEnd: HDG_SW, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  2, spotStart: SPOT_A, hdgStart: HDG_W,  spotEnd: SPOT_A, hdgEnd: HDG_W,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  3, spotStart: SPOT_A, hdgStart: HDG_NW, spotEnd: SPOT_A, hdgEnd: HDG_NW, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  4, spotStart: SPOT_B, hdgStart: HDG_SW, spotEnd: SPOT_B, hdgEnd: HDG_SW, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  5, spotStart: SPOT_B, hdgStart: HDG_S,  spotEnd: SPOT_B, hdgEnd: HDG_S,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  6, spotStart: SPOT_B, hdgStart: HDG_SE, spotEnd: SPOT_B, hdgEnd: HDG_SE, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  7, spotStart: SPOT_C, hdgStart: HDG_NE, spotEnd: SPOT_C, hdgEnd: HDG_NE, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  8, spotStart: SPOT_C, hdgStart: HDG_E,  spotEnd: SPOT_C, hdgEnd: HDG_E,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo:  9, spotStart: SPOT_D, hdgStart: HDG_NW, spotEnd: SPOT_D, hdgEnd: HDG_NW, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo: 10, spotStart: SPOT_D, hdgStart: HDG_NE, spotEnd: SPOT_D, hdgEnd: HDG_NE, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo: 11, spotStart: SPOT_E, hdgStart: HDG_NW, spotEnd: SPOT_E, hdgEnd: HDG_NW, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo: 12, spotStart: SPOT_F, hdgStart: HDG_S,  spotEnd: SPOT_F, hdgEnd: HDG_S,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo: 15, spotStart: SPOT_A, hdgStart: HDG_S,  spotEnd: SPOT_A, hdgEnd: HDG_S,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'STAND.ADS',    adsTagNo: 16, spotStart: SPOT_C, hdgStart: HDG_S,  spotEnd: SPOT_C, hdgEnd: HDG_S,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },

  { adsName: 'SUZY.ADS',     adsTagNo:  1, spotStart: 0,      hdgStart: 0,      spotEnd: 0,      hdgEnd: 0,      dayNo:  3, flags: FINAL | FIRST                                           },
  { adsName: 'SUZY.ADS',     adsTagNo:  2, spotStart: 0,      hdgStart: 0,      spotEnd: 0,      hdgEnd: 0,      dayNo:  9, flags: FINAL | FIRST                                           },

  { adsName: 'VISITOR.ADS',  adsTagNo:  1, spotStart: SPOT_A, hdgStart: HDG_S,  spotEnd: SPOT_A, hdgEnd: HDG_S,  dayNo:  0, flags: ISLAND | LOWTIDE_OK                                     },
  { adsName: 'VISITOR.ADS',  adsTagNo:  3, spotStart: SPOT_B, hdgStart: HDG_NW, spotEnd: SPOT_D, hdgEnd: 0,      dayNo:  0, flags: ISLAND | FINAL | HOLIDAY_NOK                            },
  { adsName: 'VISITOR.ADS',  adsTagNo:  4, spotStart: SPOT_D, hdgStart: HDG_S,  spotEnd: SPOT_D, hdgEnd: HDG_W,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'VISITOR.ADS',  adsTagNo:  6, spotStart: SPOT_D, hdgStart: HDG_S,  spotEnd: SPOT_D, hdgEnd: HDG_SW, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'VISITOR.ADS',  adsTagNo:  7, spotStart: SPOT_D, hdgStart: HDG_S,  spotEnd: SPOT_D, hdgEnd: HDG_SW, dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
  { adsName: 'VISITOR.ADS',  adsTagNo:  5, spotStart: SPOT_E, hdgStart: HDG_SW, spotEnd: 0,      hdgEnd: 0,      dayNo:  0, flags: ISLAND | FINAL | LEFT_ISLAND | VARPOS_OK | LOWTIDE_OK   },

  { adsName: 'WALKSTUF.ADS', adsTagNo:  1, spotStart: SPOT_A, hdgStart: HDG_NE, spotEnd: 0,      hdgEnd: 0,      dayNo:  0, flags: ISLAND | FINAL | LOWTIDE_OK                              },
  { adsName: 'WALKSTUF.ADS', adsTagNo:  2, spotStart: SPOT_E, hdgStart: HDG_E,  spotEnd: SPOT_D, hdgEnd: HDG_SE, dayNo:  0, flags: ISLAND | VARPOS_OK                                      },
  { adsName: 'WALKSTUF.ADS', adsTagNo:  3, spotStart: SPOT_D, hdgStart: HDG_W,  spotEnd: SPOT_E, hdgEnd: HDG_W,  dayNo:  0, flags: ISLAND | VARPOS_OK | LOWTIDE_OK                         },
];
