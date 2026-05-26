import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Textarea } from "@/shadcn-bridge/heroui/input";
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
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
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

const typeBadgeColor: Record<string, "primary" | "warning" | "success"> = {
  recharge: "warning",
  traffic: "primary",
  time: "success",
};

interface ProductForm {
  id?: number;
  name: string;
  description: string;
  type: string;
  priceYuan: string;
  value: number;
  sortOrder: number;
  status: number;
}

const defaultForm: ProductForm = {
  name: "",
  description: "",
  type: "traffic",
  priceYuan: "0",
  value: 0,
  sortOrder: 0,
  status: 1,
};

const typeUnit: Record<string, string> = {
  recharge: "分",
  traffic: "GB",
  time: "天",
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

  const activeCount = products.filter((p) => p.status === 1).length;
  const typeCounts: Record<string, number> = {};
  for (const p of products) {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
  }

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
      priceYuan: (item.price / 100).toFixed(2),
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
      const priceFen = Math.round(parseFloat(form.priceYuan || "0") * 100);
      const data = {
        id: form.id,
        name: form.name,
        description: form.description,
        type: form.type,
        price: priceFen,
        value: form.value,
        sortOrder: form.sortOrder,
        status: form.status,
      };
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
      <div className="flex items-center justify-between mb-4">
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">商品总数</div>
            <div className="text-2xl font-semibold">{products.length}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">上架</div>
            <div className="text-2xl font-semibold text-green-600">{activeCount}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">下架</div>
            <div className="text-2xl font-semibold text-gray-400">{products.length - activeCount}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">类型分布</div>
            <div className="text-base">
              {productTypeOptions.map((opt) => (
                <span key={opt.value} className="mr-2">
                  {opt.label}
                  <span className="ml-1 font-semibold">{typeCounts[opt.value] || 0}</span>
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
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
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium">{item.name}</div>
                  {item.description && (
                    <div className="text-xs text-gray-400 truncate max-w-40">{item.description}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Chip color={typeBadgeColor[item.type] || "default"} size="sm" variant="flat">
                    {typeLabel}
                  </Chip>
                </TableCell>
                <TableCell className="font-mono">{(item.price / 100).toFixed(2)} 元</TableCell>
                <TableCell>{item.value} {typeUnit[item.type] || ""}</TableCell>
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
            <div className="space-y-1">
              <label className="text-sm text-gray-400">说明</label>
              <Textarea value={form.description} variant="bordered" className="w-full min-h-20"
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
              <Input label="价格 (元)" type="number" step="0.01" min="0" value={form.priceYuan} variant="bordered"
                onChange={(e) => setForm((p) => ({ ...p, priceYuan: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="价值" type="number" min="0" value={String(form.value)} variant="bordered"
                onChange={(e) => setForm((p) => ({ ...p, value: parseInt(e.target.value) || 0 }))} />
              <Input label="排序" type="number" min="0" value={String(form.sortOrder)} variant="bordered"
                onChange={(e) => setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))} />
            </div>
            <Select label="状态" variant="bordered"
              selectedKeys={[String(form.status)]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string;
                if (val) setForm((p) => ({ ...p, status: parseInt(val) }));
              }}>
              <SelectItem key="1">上架</SelectItem>
              <SelectItem key="0">下架</SelectItem>
            </Select>
            <div className="text-xs text-gray-400">
              {form.type === "recharge" ? "价值单位：分（充值到余额）" :
               form.type === "traffic" ? "价值单位：GB（增加流量）" :
               "价值单位：天（延长有效期）"}
            </div>
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
