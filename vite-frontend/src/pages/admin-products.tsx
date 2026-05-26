import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import {
  getProductList,
  createProduct,
  updateProduct,
  deleteProduct,
} from "@/api";
import type { ProductApiItem } from "@/api/types";
import { PageLoadingState } from "@/components/page-state";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";

const productTypeOptions = [
  { value: "recharge", label: "余额充值" },
  { value: "traffic", label: "流量包" },
  { value: "time", label: "时长续费" },
];

interface ProductForm {
  id?: number;
  name: string;
  description: string;
  type: string;
  price: number;
  value: number;
  sortOrder: number;
  status: number;
}

const defaultForm: ProductForm = {
  name: "",
  description: "",
  type: "traffic",
  price: 0,
  value: 0,
  sortOrder: 0,
  status: 1,
};

export default function AdminProductsPage() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductApiItem[]>([]);
  const [searchKeyword, setSearchKeyword] = useLocalStorageState("admin-products-search", "");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<ProductForm>({ ...defaultForm });
  const [itemToDelete, setItemToDelete] = useState<ProductApiItem | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProductList();
      if (res.code === 0) {
        setProducts(Array.isArray(res.data) ? res.data : []);
      } else {
        toast.error(res.msg || "获取商品列表失败");
      }
    } catch {
      toast.error("获取商品列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = products.filter((p) =>
    !searchKeyword || p.name?.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  const handleAdd = () => {
    setForm({ ...defaultForm });
    setIsEdit(false);
    setModalOpen(true);
  };

  const handleEdit = (item: ProductApiItem) => {
    setForm({
      id: item.id,
      name: item.name,
      description: item.description || "",
      type: item.type,
      price: item.price,
      value: item.value,
      sortOrder: item.sortOrder || 0,
      status: item.status,
    });
    setIsEdit(true);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("商品名称不能为空");
      return;
    }
    setSubmitLoading(true);
    try {
      const data = { ...form };
      const res = isEdit ? await updateProduct(data) : await createProduct(data);
      if (res.code === 0) {
        toast.success(isEdit ? "更新成功" : "创建成功");
        setModalOpen(false);
        loadData();
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = (item: ProductApiItem) => {
    setItemToDelete(item);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      const res = await deleteProduct(itemToDelete.id);
      if (res.code === 0) {
        toast.success("已删除");
        setDeleteModalOpen(false);
        setItemToDelete(null);
        loadData();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误");
    }
  };

  if (loading) return <PageLoadingState message="加载商品中..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">商品管理</h1>
        <div className="flex gap-2">
          <SearchBar
            isVisible={isSearchVisible}
            placeholder="搜索商品..."
            value={searchKeyword}
            onChange={setSearchKeyword}
            onClose={() => { setIsSearchVisible(false); setSearchKeyword(""); }}
            onOpen={() => setIsSearchVisible(true)}
          />
          <Button color="primary" size="sm" variant="flat" onPress={handleAdd}>
            新增商品
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableColumn>名称</TableColumn>
          <TableColumn>类型</TableColumn>
          <TableColumn>价格</TableColumn>
          <TableColumn>价值</TableColumn>
          <TableColumn>排序</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>操作</TableColumn>
        </TableHeader>
        <TableBody>
          {filtered.map((item) => {
            const typeLabel = productTypeOptions.find((t) => t.value === item.type)?.label || item.type;
            const typeUnit = item.type === "traffic" ? "GB" : item.type === "time" ? "天" : "分";
            return (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{typeLabel}</TableCell>
                <TableCell>{(item.price / 100).toFixed(2)} 元</TableCell>
                <TableCell>{item.value} {typeUnit}</TableCell>
                <TableCell>{item.sortOrder}</TableCell>
                <TableCell>
                  <Chip color={item.status === 1 ? "success" : "default"} size="sm">
                    {item.status === 1 ? "上架" : "下架"}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="flat" onPress={() => handleEdit(item)}>编辑</Button>
                    <Button size="sm" color="danger" variant="flat" onPress={() => handleDelete(item)}>删除</Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Modal isOpen={modalOpen} placement="center" size="2xl"
        onOpenChange={(open) => { if (!open) setModalOpen(false); }}>
        <ModalContent>
          <ModalHeader>{isEdit ? "编辑商品" : "新增商品"}</ModalHeader>
          <ModalBody className="space-y-4">
            <Input label="商品名称" value={form.name} variant="bordered"
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <Input label="描述" value={form.description} variant="bordered"
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            <Select label="类型" variant="bordered"
              selectedKeys={[form.type]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string;
                if (val) setForm((p) => ({ ...p, type: val }));
              }}>
              {productTypeOptions.map((opt) => (
                <SelectItem key={opt.value}>{opt.label}</SelectItem>
              ))}
            </Select>
            <Input label="价格 (分)" type="number" value={String(form.price)} variant="bordered"
              onChange={(e) => setForm((p) => ({ ...p, price: parseInt(e.target.value) || 0 }))} />
            <Input label="价值 (流量GB/天数/充值分数)" type="number" value={String(form.value)} variant="bordered"
              onChange={(e) => setForm((p) => ({ ...p, value: parseInt(e.target.value) || 0 }))} />
            <Input label="排序" type="number" value={String(form.sortOrder)} variant="bordered"
              onChange={(e) => setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))} />
            <Select label="状态" variant="bordered"
              selectedKeys={[String(form.status)]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string;
                if (val) setForm((p) => ({ ...p, status: parseInt(val) }));
              }}>
              <SelectItem key="1">上架</SelectItem>
              <SelectItem key="0">下架</SelectItem>
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setModalOpen(false)}>取消</Button>
            <Button color="primary" isLoading={submitLoading} onPress={handleSubmit}>确定</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={deleteModalOpen} placement="center"
        onOpenChange={(open) => { if (!open) { setDeleteModalOpen(false); setItemToDelete(null); } }}>
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            确定要删除商品"{itemToDelete?.name}"吗？
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setDeleteModalOpen(false); setItemToDelete(null); }}>取消</Button>
            <Button color="danger" onPress={confirmDelete}>删除</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
