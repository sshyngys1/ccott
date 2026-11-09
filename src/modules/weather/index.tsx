import { t } from "../../i18n";
import { deferredScreen } from "../../lib/deferredScreen";
import type { IslandModule } from "../../shared/types";
import { useWeatherActive, WeatherPill, WEATHER_PRIORITY } from "./activity";
import { WeatherIcon } from "./icons";

export const weatherScreen = deferredScreen(() => import("./WeatherTab").then(m => ({ default: m.WeatherTab })));
const weather: IslandModule = {
  id: "weather", get title() { return t("weather.title"); }, icon: WeatherIcon,
  Tab: weatherScreen.Screen, order: 5,
  compact: { useIsActive: useWeatherActive, priority: WEATHER_PRIORITY, View: WeatherPill },
};
export default weather;
