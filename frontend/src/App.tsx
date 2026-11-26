// 라우팅과 전역 Provider(QueryClient). 4xx 는 재시도하지 않고 네트워크/5xx 만 2회까지 재시도한다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { Empty } from "./components/ui";
import { Admin } from "./pages/Admin";
import { Login, Register } from "./pages/Auth";
import { Bookmarks } from "./pages/Bookmarks";
import { Catalog } from "./pages/Catalog";
import { Home } from "./pages/Home";
import { ItemDetail } from "./pages/ItemDetail";
import { Methodology } from "./pages/Methodology";
import { Search } from "./pages/Search";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => count < 2 && !(isAxiosError(err) && err.response && err.response.status < 500),
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="items/:id" element={<ItemDetail />} />
          <Route path="search" element={<Search />} />
          <Route path="methodology" element={<Methodology />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="bookmarks" element={<RequireAuth><Bookmarks /></RequireAuth>} />
          <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
          <Route path="*" element={<Empty>페이지를 찾을 수 없습니다.</Empty>} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
