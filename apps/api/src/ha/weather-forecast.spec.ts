import { HaEntityState } from './ha-http-client';
import {
  humanizeCondition,
  parseForecast,
  shapeWeather,
} from './weather-forecast';

function st(state: string, attributes?: Record<string, unknown>): HaEntityState {
  return { entity_id: 'weather.home', state, attributes };
}

const RESPONSE = {
  service_response: {
    'weather.home': {
      forecast: [
        { condition: 'partlycloudy', templow: 54, temperature: 78 },
        { condition: 'sunny', templow: 58, temperature: 81 },
      ],
    },
  },
};

describe('parseForecast', () => {
  it('pulls today (first entry) condition/low/high from the wrapped response', () => {
    expect(parseForecast(RESPONSE, 'weather.home')).toEqual({
      condition: 'partlycloudy',
      tempLow: 54,
      tempHigh: 78,
    });
  });

  it('accepts a bare entity map too', () => {
    expect(
      parseForecast(RESPONSE.service_response, 'weather.home'),
    ).toEqual({ condition: 'partlycloudy', tempLow: 54, tempHigh: 78 });
  });

  it('returns null on an unrecognized/empty shape', () => {
    expect(parseForecast({}, 'weather.home')).toBeNull();
    expect(parseForecast({ service_response: { 'weather.home': { forecast: [] } } }, 'weather.home')).toBeNull();
  });
});

describe('humanizeCondition', () => {
  it('title-cases a slug', () => {
    expect(humanizeCondition('partlycloudy')).toBe('Partlycloudy');
    expect(humanizeCondition('clear-night')).toBe('Clear Night');
    expect(humanizeCondition(undefined)).toBeUndefined();
  });
});

describe('shapeWeather (forecast-poll folding)', () => {
  it('returns undefined when unconfigured', () => {
    expect(shapeWeather(null, undefined, null)).toBeUndefined();
  });

  it('joins live current temp with the cached forecast', () => {
    const forecast = parseForecast(RESPONSE, 'weather.home');
    const weather = shapeWeather(
      'weather.home',
      st('partlycloudy', { temperature: 72 }),
      forecast,
    );
    expect(weather).toEqual({
      avail: 'ok',
      tempNow: 72,
      condition: 'Partlycloudy',
      tempLow: 54,
      tempHigh: 78,
    });
  });

  it('shows current temp with no forecast yet (thin block)', () => {
    const weather = shapeWeather(
      'weather.home',
      st('sunny', { temperature: 70 }),
      null,
    );
    expect(weather).toMatchObject({ avail: 'ok', tempNow: 70, condition: 'Sunny' });
    expect(weather?.tempLow).toBeUndefined();
    expect(weather?.tempHigh).toBeUndefined();
  });

  it('is unavailable when configured but offline/unknown', () => {
    expect(shapeWeather('weather.home', undefined, null)).toEqual({ avail: 'unavailable' });
    expect(shapeWeather('weather.home', st('unavailable'), null)).toEqual({ avail: 'unavailable' });
  });
});
