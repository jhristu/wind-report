export interface WgSpot {
  id: number;
  name: string;
  country: string | null;
  timezone: string;
  lat: number;
  lon: number;
  models: string[];
}

export interface WgForecast {
  model: string;
  model_name: string;
  run: string;
  hours: number[];
  time: string[];
  WINDSPD?: Array<number | null>;
  GUST?: Array<number | null>;
  WINDDIR?: Array<number | null>;
}

export interface WgForecastResponse {
  spot: WgSpot;
  units: Record<string, string>;
  forecasts: WgForecast[];
  meta?: {
    cost?: number;
    cached?: boolean;
    request_id?: string;
    attribution?: Array<{ provider: string; text: string; url?: string }>;
  };
}

export interface Slot {
  time: string;
  wind: number | null;
  gust: number | null;
  direction: number | null;
  hour: number;
  minute: number;
  isNow: boolean;
  isMidnight: boolean;
}

export interface LiveWind {
  station: string;
  windMs: number;
  windKt: number;
  directionDeg: number | null;
  time: string;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}
