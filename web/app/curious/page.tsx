import { redirect } from "next/navigation";

// /curious has no content of its own — it is the pair of tabs below it. The
// design system is the friendlier of the two to land on cold.
export default function CuriousIndex() {
  redirect("/curious/design");
}
