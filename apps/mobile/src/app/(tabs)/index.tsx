import { useCallback, useRef, type ComponentRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Link, useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import { Image } from "expo-image";
import {
  ActionLink,
  Button,
  FeatureLink,
  Card,
  SectionHeading,
} from "../../components/Controls";
import { Icon } from "../../components/Icon";
import { PhotoBackdrop } from "../../components/PhotoBackdrop";
import { Screen } from "../../components/Screen";
import { useResource } from "../../mvp/Provider";
import { ProductTile, ResourceState, ui } from "../../mvp/Components";
import { ExternalAction } from "../../mvp/ExternalAction";
import { storefront } from "../../theme";

// Approved website category artwork is navigation imagery, not stock evidence.
const categories = [
  {
    label: "Sports Cards",
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles static image resources through require.
    image: require("../../../assets/home/sports.webp"),
    query: "",
  },
  {
    label: "Pokémon",
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles static image resources through require.
    image: require("../../../assets/home/pokemon.webp"),
    query: "Pokémon",
  },
  {
    label: "Entertainment",
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles static image resources through require.
    image: require("../../../assets/home/entertainment.webp"),
    query: "Entertainment",
  },
];
const categoryKey = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US");

export default function HomeScreen() {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const lounge = useRef<ComponentRef<typeof View>>(null);
  const events = useRef<ComponentRef<typeof View>>(null);
  function scrollToSection(target: ComponentRef<typeof View> | null) {
    const content = scroll.current?.getInnerViewRef();
    if (!target || !content) return;
    // Measure on demand: loading product images can move sections after layout.
    target.measureLayout(
      content,
      (_x, y) => scroll.current?.scrollTo({ y, animated: true }),
      () => {},
    );
  }
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light");
      return () => setStatusBarStyle("dark");
    }, []),
  );
  const catalog = useResource(
    (api, signal) => api.catalog({}, signal),
    "home-catalog",
  );
  const releases = useResource(
    (api, signal) => api.releases(signal),
    "home-releases",
  );
  const singles = useResource(
    (api, signal) => api.catalog({ feed: "singles-new-arrivals" }, signal),
    "home-singles-new-arrivals",
  );
  const info = useResource((api, signal) => api.info(signal), "home-info");
  return (
    <Screen
      appearance="storefront"
      scrollRef={scroll}
      eyebrow="CARDS. COMMUNITY. NORTHSIDE."
      title="HOBBY LIVES HERE."
      titleContent={
        <>
          HOBBY{"\n"}LIVES <Text style={styles.blue}>HERE.</Text>
        </>
      }
      description={"Your next great find.\nYour kind of people."}
      headerAccessory={
        <View style={styles.searchHeader}>
          <Link href="/shop" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Find your next favorite. Search products"
              style={styles.search}
            >
              <Text style={styles.searchCopy}>Find your next favorite…</Text>
              <Icon name="search" color={storefront.colors.white} />
            </Pressable>
          </Link>
        </View>
      }
      introBackground={
        <PhotoBackdrop
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles static image resources through require.
          source={require("../../../assets/home/northside-led-wall.webp")}
        />
      }
      introAction={
        <View style={styles.actions}>
          <ActionLink
            appearance="storefront"
            href="/shop"
            label="Shop Products"
          />
          <Button
            appearance="storefront"
            inverse
            label="Explore the Lounge"
            onPress={() => scrollToSection(lounge.current)}
          />
        </View>
      }
      introFooter={
        <Text style={styles.caption}>FOR THE LOVE OF THE COLLECTION</Text>
      }
    >
      <View style={styles.section}>
        <SectionHeading eyebrow="Find your thing" title="Shop by category" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {categories.map((category) => {
            // Prefer the API's real category, including unaccented Shopify labels.
            const match = catalog.data?.categories.find(
              (value) => categoryKey(value) === categoryKey(category.label),
            );
            return (
              <Link
                key={category.label}
                href={{
                  pathname: "/shop",
                  params: {
                    q: match ? "" : category.query,
                    category: match ?? "",
                  },
                }}
                asChild
              >
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Browse ${category.label}`}
                  style={styles.category}
                >
                  <Image
                    source={category.image}
                    alt=""
                    contentFit="contain"
                    accessible={false}
                    style={styles.categoryImage}
                  />
                  <Text style={styles.categoryTitle}>{category.label}</Text>
                </Pressable>
              </Link>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.section}>
        <SectionHeading title="Featured Products" />
        <ResourceState
          appearance="storefront"
          resource={catalog}
          title="Featured merchandise"
        />
        {catalog.data && catalog.status === "ready" && (
          <>
            <View style={ui.list}>
              {catalog.data.products.slice(0, 4).map((product) => (
                <ProductTile
                  appearance="storefront"
                  key={product.id}
                  product={product}
                />
              ))}
            </View>
            {!catalog.data.products.length && (
              <Card appearance="storefront">
                <Text style={styles.heading}>Your next find is coming.</Text>
                <Text style={styles.copy}>
                  There are no published products to show yet. Check back for
                  the latest from Northside.
                </Text>
                <ActionLink
                  appearance="storefront"
                  secondary
                  href="/shop"
                  label="Explore the shop"
                />
              </Card>
            )}
          </>
        )}
      </View>
      <View style={styles.section}>
        <SectionHeading title="New Releases" />
        <ResourceState
          appearance="storefront"
          resource={releases}
          title="Releases"
        />
        {releases.status === "ready" && releases.data && (
          <>
            <View style={ui.list}>
              {releases.data.products.slice(0, 4).map((product) => (
                <ProductTile
                  appearance="storefront"
                  key={product.id}
                  product={product}
                />
              ))}
            </View>
            {!releases.data.products.length && (
              <Card appearance="storefront">
                <Text style={styles.heading}>Something new is on the way.</Text>
                <Text style={styles.copy}>
                  Published new releases will appear here. Check the shop for
                  the current collection.
                </Text>
                <ActionLink
                  appearance="storefront"
                  secondary
                  href="/shop"
                  label="Browse the collection"
                />
              </Card>
            )}
          </>
        )}
      </View>
      <View style={styles.section}>
        <SectionHeading eyebrow="Singles" title="New Arrivals" />
        <ResourceState
          appearance="storefront"
          resource={singles}
          title="Singles arrivals"
        />
        {singles.status === "ready" && singles.data && (
          <>
            <View style={ui.list}>
              {singles.data.products.slice(0, 4).map((product) => (
                <ProductTile
                  appearance="storefront"
                  key={product.id}
                  product={product}
                />
              ))}
            </View>
            {!singles.data.products.length && (
              <Text style={styles.copy}>
                {singles.data.pageInfo.hasNextPage
                  ? "No verified singles found in this part of the arrival selection. Continue browsing for more."
                  : "No verified singles arrivals are available in the published collection."}
              </Text>
            )}
            <ActionLink
              appearance="storefront"
              secondary
              href={{
                pathname: "/shop",
                params: { feed: "singles-new-arrivals" },
              }}
              label="Browse singles arrivals"
            />
          </>
        )}
      </View>
      <View ref={events} style={styles.section}>
        <SectionHeading eyebrow="Better together" title="Events at Northside" />
        <ResourceState
          appearance="storefront"
          resource={info}
          title="Store information"
          icon="home"
        />
        {info.data && (
          <>
            {info.data.events.status === "ready" ? (
              info.data.events.items.length ? (
                info.data.events.items.map((event) => (
                  <Card appearance="storefront" key={event.id}>
                    <Text style={styles.heading}>{event.title}</Text>
                    <Text style={styles.copy}>
                      {event.startsAt
                        ? new Intl.DateTimeFormat("en-US", {
                            timeZone: "America/Chicago",
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(event.startsAt)) +
                          " · Central time"
                        : "Date to be announced"}
                    </Text>
                    <Text style={styles.copy}>
                      {event.location ?? "Location to be announced"}
                    </Text>
                    <Text style={styles.copy}>{event.description}</Text>
                  </Card>
                ))
              ) : (
                <Text style={styles.copy}>
                  No upcoming Northside events are currently published.
                </Text>
              )
            ) : (
              <Text style={styles.copy}>
                Event information could not be verified. Refresh when connected.
              </Text>
            )}
          </>
        )}
        <Card appearance="storefront">
          <Text style={styles.heading}>Visit Northside</Text>
          <Text style={styles.copy}>
            {"6800 Forest Hills Road, Unit 3, Loves Park, IL."}
          </Text>
          {info.data?.store.hours.length ? (
            info.data.store.hours.map((hours, i) => (
              <Text key={i} style={styles.copy}>
                {hours}
              </Text>
            ))
          ) : (
            <Text style={styles.copy}>
              Opening hours are not yet confirmed in the app.
            </Text>
          )}
          <ExternalAction
            appearance="storefront"
            url={info.data?.store.website ?? null}
            label="Northside website"
          />
        </Card>
      </View>
      <View ref={lounge} style={styles.lounge}>
        <PhotoBackdrop
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles static image resources through require.
          source={require("../../../assets/home/northside-lounge-bar.webp")}
        />
        <Text style={styles.inverseEyebrow}>THE NORTHSIDE SPORTS LOUNGE</Text>
        <Text accessibilityRole="header" style={styles.loungeTitle}>
          THE NORTHSIDE{"\n"}
          <Text style={styles.cyan}>SPORTS LOUNGE</Text>
        </Text>
        <Text style={styles.inverseCopy}>
          {"Great cards. Good company.\nMake yourself at home at Northside."}
        </Text>
        <Button
          appearance="storefront"
          inverse
          label="See what’s happening"
          onPress={() => scrollToSection(events.current)}
        />
      </View>
      <View style={styles.section}>
        <SectionHeading
          eyebrow="Northside Rewards"
          title="Your hobby has its perks."
        />
        <Text style={styles.copy}>
          Keep your collection moving. Keep your rewards close.
        </Text>
        <FeatureLink
          appearance="storefront"
          href="/wallet"
          icon="wallet"
          title="Your Northside wallet"
          detail="View your rewards and balances."
        />
      </View>
      <View style={styles.section}>
        <SectionHeading
          eyebrow="For the love of the collection"
          title="Your Northside"
        />
        <FeatureLink
          appearance="storefront"
          href="/scan"
          icon="scan"
          title="Find a card"
          detail="Scan a barcode or enter a code."
        />
        <FeatureLink
          appearance="storefront"
          href="/account"
          icon="account"
          title="Your collecting journey"
          detail="Orders, grading and services."
        />
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  copy: {
    ...storefront.type.body,
    fontFamily: storefront.fontFamily,
    color: storefront.colors.body,
  },
  heading: {
    fontSize: 21,
    lineHeight: 28,
    fontFamily: storefront.fontFamily,
    fontWeight: "700",
    color: storefront.colors.ink,
  },
  section: { gap: 20 },
  blue: { color: storefront.colors.electricBlue },
  cyan: { color: storefront.colors.cyan },
  actions: { gap: 12, marginTop: 12 },
  caption: {
    fontFamily: storefront.fontFamily,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1.5,
    color: storefront.colors.inverseAccent,
    marginTop: 12,
  },
  searchHeader: {
    backgroundColor: storefront.colors.hero,
    paddingHorizontal: 24,
    paddingBottom: 18,
  },
  search: {
    minHeight: 54,
    padding: 14,
    borderWidth: 1,
    borderColor: storefront.colors.inverseBorder,
    backgroundColor: storefront.colors.search,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchCopy: {
    fontFamily: storefront.fontFamily,
    fontSize: 16,
    lineHeight: 24,
    color: storefront.colors.inverseBody,
    flex: 1,
  },
  categories: { gap: 12, paddingBottom: 4, flexGrow: 1 },
  category: {
    width: 176,
    flexGrow: 1,
    backgroundColor: storefront.colors.hero,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: storefront.colors.inverseBorder,
    gap: 12,
  },
  categoryImage: { width: "100%", height: 142 },
  categoryTitle: {
    fontFamily: storefront.displayFamily,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    textTransform: "uppercase",
    color: storefront.colors.white,
  },
  lounge: {
    backgroundColor: storefront.colors.hero,
    marginHorizontal: -24,
    padding: 24,
    paddingTop: 72,
    paddingBottom: 36,
    gap: 24,
    borderBottomWidth: 3,
    borderBottomColor: storefront.colors.electricBlue,
  },
  inverseEyebrow: {
    ...storefront.type.eyebrow,
    color: storefront.colors.inverseAccent,
  },
  loungeTitle: {
    ...storefront.type.heading,
    fontSize: 34,
    lineHeight: 38,
    fontFamily: storefront.displayFamily,
    color: storefront.colors.white,
  },
  inverseCopy: {
    ...storefront.type.body,
    color: storefront.colors.inverseBody,
  },
});
