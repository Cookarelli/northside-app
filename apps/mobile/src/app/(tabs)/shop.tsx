import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, Keyboard } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  catalogInputSchema,
  type CatalogInput,
} from "@northside/customer-contracts/mvp";
import { CustomerScreen as Screen } from "../../components/CustomerScreen";
import { Button, Card } from "../../components/Controls";
import { useResource } from "../../mvp/Provider";
import {
  ProductTile,
  ResourceState,
  storefrontUi as ui,
} from "../../mvp/Components";
import { usePrivatePreview } from "../../private-preview/context";
export default function ShopScreen() {
  const {
    q,
    category: linkedCategory,
    feed: linkedFeed,
  } = useLocalSearchParams<{
    q?: string | string[];
    category?: string | string[];
    feed?: string | string[];
  }>();
  const router = useRouter();
  const privatePreview = usePrivatePreview();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [after, setAfter] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([]),
    [categories, setCategories] = useState<string[]>([]),
    [feed, setFeed] = useState<CatalogInput["feed"]>();
  // Adjust the form before committing a changed navigation input. Consuming it
  // once preserves later manual edits, including returning to the same category.
  const navigationKey = JSON.stringify([q, linkedCategory, linkedFeed]);
  const [previousNavigation, setPreviousNavigation] = useState<string>();
  if (navigationKey !== previousNavigation) {
    setPreviousNavigation(navigationKey);
    const parsed = catalogInputSchema.safeParse({
      q: q === "" ? undefined : q,
      category: linkedCategory === "" ? undefined : linkedCategory,
      feed: linkedFeed,
    });
    if (
      parsed.success &&
      (q !== undefined || linkedCategory !== undefined || linkedFeed !== undefined)
    ) {
      setQuery(parsed.data.q ?? "");
      setSubmitted(parsed.data.q ?? "");
      setCategory(parsed.data.category ?? "");
      setFeed(parsed.data.feed);
      setAfter(undefined);
      setHistory([]);
    }
  }
  // Only the router is an external system; the form state above is derived from
  // the new route before effects or network reads commit.
  useEffect(() => {
    if (
      q === undefined &&
      linkedCategory === undefined &&
      linkedFeed === undefined
    )
      return;
    router.setParams({ q: undefined, category: undefined, feed: undefined });
  }, [q, linkedCategory, linkedFeed, router]);
  const input = {
    ...(submitted ? { q: submitted } : {}),
    ...(category ? { category } : {}),
    ...(after ? { after } : {}),
    ...(feed ? { feed } : {}),
  };
  const resource = useResource(
    (api, signal) => api.catalog(input, signal),
    JSON.stringify(input),
  );
  const [categoryResponse, setCategoryResponse] = useState(resource.data);
  if (resource.data && resource.data !== categoryResponse) {
    setCategoryResponse(resource.data);
    setCategories(resource.data.categories);
  }
  function search() {
    Keyboard.dismiss();
    setHistory([]);
    setAfter(undefined);
    setSubmitted(query.trim());
    resource.reload();
  }
  return (
    <Screen
      eyebrow="Discover Northside"
      title="Find your next favorite."
      description="Explore the collection. Find the cards and collectibles you love."
    >
      <Card appearance="storefront">
        {!privatePreview && (
          <View
            style={ui.chips}
            accessibilityRole="radiogroup"
            accessibilityLabel="Catalog selection"
          >
            {[
              { label: "All merchandise", value: undefined },
              {
                label: "Singles · New Arrivals",
                value: "singles-new-arrivals" as const,
              },
            ].map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: feed === option.value }}
                style={[ui.chip, feed === option.value && ui.selected]}
                onPress={() => {
                  setFeed(option.value);
                  setCategory("");
                  setCategories([]);
                  setAfter(undefined);
                  setHistory([]);
                }}
              >
                <Text
                  style={[ui.label, feed === option.value && ui.selectedLabel]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {feed && (
          <Text style={ui.copy}>
            Verified singles selected for New Arrivals. Selection and order come
            from Northside’s approved Shopify collections.
          </Text>
        )}
        <Text style={ui.label}>Search products</Text>
        <TextInput
          accessibilityLabel="Search products"
          placeholder="Title, set or description"
          value={query}
          onChangeText={setQuery}
          maxLength={100}
          returnKeyType="search"
          onSubmitEditing={search}
          style={ui.input}
          autoCorrect={false}
        />
        <View
          style={ui.chips}
          accessibilityRole="radiogroup"
          accessibilityLabel="Product category"
        >
          {["", ...categories].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={value || "All"}
              accessibilityState={{ checked: category === value }}
              style={[ui.chip, category === value && ui.selected]}
              onPress={() => {
                setCategory(value);
                setAfter(undefined);
                setHistory([]);
              }}
            >
              <Text style={[ui.label, category === value && ui.selectedLabel]}>
                {value || "All"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button
          appearance="storefront"
          label="Search catalog"
          onPress={search}
        />
        {(query || category || submitted) && (
          <Button
            appearance="storefront"
            secondary
            label="Clear search"
            onPress={() => {
              setQuery("");
              setSubmitted("");
              setCategory("");
              setAfter(undefined);
              setHistory([]);
            }}
          />
        )}
      </Card>
      <ResourceState
        appearance="storefront"
        resource={resource}
        title={feed ? "Singles arrivals" : "Catalog"}
      />
      {resource.status === "ready" && resource.data && (
        <>
          {!resource.data.products.length && (
            <Text style={ui.copy}>
              {resource.data.kind === "private-catalog"
                ? "No items in this private selection match your search."
                : resource.data.pageInfo.hasNextPage
                  ? "No matches on this page. Continue searching the approved collection."
                  : feed
                    ? "No published, approved singles arrivals match this search."
                    : "No published, approved products match this search."}
            </Text>
          )}
          <View style={ui.list}>
            {resource.data.products.map((product) => (
              <ProductTile
                appearance="storefront"
                key={product.id}
                product={product}
              />
            ))}
          </View>
          {resource.data.pageInfo.hasNextPage && (
            <Button
              appearance="storefront"
              label="Next products"
              onPress={() => {
                setHistory((values) => [...values, after]);
                setAfter(resource.data?.pageInfo.endCursor ?? undefined);
              }}
            />
          )}
          {!!history.length && (
            <Button
              appearance="storefront"
              label="Previous products"
              onPress={() => {
                setAfter(history[history.length - 1]);
                setHistory(history.slice(0, -1));
              }}
            />
          )}
          <Button
            appearance="storefront"
            secondary
            label="Refresh catalog"
            onPress={resource.reload}
          />
          <Text style={ui.copy}>
            {resource.data.kind === "private-catalog"
              ? "This selection is for browsing. Catalog prices may change before release."
              : "Online availability does not confirm shelf stock or reserve an item. Purchasing is not enabled."}
          </Text>
        </>
      )}
    </Screen>
  );
}
