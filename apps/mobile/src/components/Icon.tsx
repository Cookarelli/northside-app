import Svg, { Path, Rect, Circle } from "react-native-svg";
import { Platform, type ColorValue } from "react-native";
import { colors } from "../theme";

export type IconName =
  "home" | "shop" | "scan" | "wallet" | "account" | "arrow" | "search";

export function Icon({
  name,
  color = colors.charcoal,
  size = 24,
}: {
  name: IconName;
  color?: ColorValue;
  size?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(Platform.OS === "web"
        ? { "aria-hidden": true }
        : { accessible: false, accessibilityElementsHidden: true })}
    >
      {name === "home" ? <Path d="m3 10 9-7 9 7v10H15v-6H9v6H3Z" /> : null}
      {name === "shop" ? (
        <>
          <Path d="M5 8h14l1 13H4L5 8Z" />
          <Path d="M8 8V6a4 4 0 0 1 8 0v2" />
        </>
      ) : null}
      {name === "scan" ? (
        <>
          <Path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10" />
          <Path d="M8 9v6m4-6v6m4-6v6" />
        </>
      ) : null}
      {name === "wallet" ? (
        <>
          <Rect x={3} y={5} width={18} height={15} rx={3} />
          <Path d="M17 10h4v6h-4a3 3 0 0 1 0-6ZM4 5l13-2" />
        </>
      ) : null}
      {name === "account" ? (
        <>
          <Circle cx={12} cy={7} r={4} />
          <Path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      ) : null}
      {name === "arrow" ? <Path d="M5 12h14m-5-5 5 5-5 5" /> : null}
      {name === "search" ? <><Circle cx={10} cy={10} r={7} /><Path d="m15 15 6 6" /></> : null}
    </Svg>
  );
}
