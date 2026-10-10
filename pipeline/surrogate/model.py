"""The surrogate net: a small U-Net that reads the terrain and the ambient
wind's direction and draws WindNinja's momentum solution (terrain only,
30 m, neutral air) at 10 m above the ground.

In, five channels per cell (fields.py says how each is made):
  rel     height above the 5.8 km local mean, / 100 m
  gx, gy  dz/dx (east) and dz/dy (north), dimensionless
  ex, ey  the ambient unit wind, the same number in every cell
Out, three:
  du, dv  the departure from the ambient, so the wind is (ex + du, ey + dv)
          in ambient units; the head starts at zero, so an untrained net
          already answers "the wind is the forecast", the baseline it has
          to beat
  turb    WindNinja's velocity fluctuation in the lowest 10 m / ambient

Four halvings (30 m to 480 m cells), widths 32-64-128-256 and 256 at the
bottom, residual blocks of two 3 x 3 convolutions with GroupNorm and SiLU,
reflect padding everywhere so the domain edge looks like more terrain,
not a wall. About 4.5 M weights and a reach of roughly 200 cells (6 km),
the scale on which a ridge bends the air. Fully convolutional: any size
goes in, padded to a multiple of 16 and cropped back.

    py -3.14 pipeline/surrogate/model.py     (prints the size and a dry run)
"""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn

from fields import N_IN, N_OUT

WIDTHS = (32, 64, 128, 256, 256)


def conv3(cin: int, cout: int) -> nn.Conv2d:
    return nn.Conv2d(cin, cout, 3, padding=1, padding_mode="reflect")


def norm(c: int) -> nn.GroupNorm:
    return nn.GroupNorm(min(8, c // 4), c)


class Block(nn.Module):
    def __init__(self, cin: int, cout: int):
        super().__init__()
        self.c1, self.n1 = conv3(cin, cout), norm(cout)
        self.c2, self.n2 = conv3(cout, cout), norm(cout)
        self.skip = nn.Conv2d(cin, cout, 1) if cin != cout else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.silu(self.n1(self.c1(x)))
        h = self.n2(self.c2(h))
        return F.silu(h + self.skip(x))


class Up(nn.Module):
    """Bilinear doubling, a 1 x 1 squeeze to half the width (the skip
    carries the fine detail; the coarse path only has to say where), the
    skip joined on, one block."""

    def __init__(self, cin: int, cskip: int, cout: int):
        super().__init__()
        self.squeeze = nn.Conv2d(cin, cin // 2, 1)
        self.block = Block(cin // 2 + cskip, cout)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
        return self.block(torch.cat([self.squeeze(x), skip], dim=1))


class UNet(nn.Module):
    def __init__(self, widths: tuple[int, ...] = WIDTHS, cin: int = N_IN, cout: int = N_OUT):
        super().__init__()
        self.widths = tuple(widths)
        self.multiple = 2 ** (len(widths) - 1)
        self.down = nn.ModuleList()
        prev = cin
        for w in widths:
            self.down.append(Block(prev, w))
            prev = w
        self.up = nn.ModuleList()
        for lvl in range(len(widths) - 2, -1, -1):
            self.up.append(Up(prev, widths[lvl], widths[lvl]))
            prev = widths[lvl]
        self.head = nn.Conv2d(prev, cout, 1)
        nn.init.zeros_(self.head.weight)
        nn.init.zeros_(self.head.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        H, W = x.shape[-2:]
        m = self.multiple
        ph, pw = (-H) % m, (-W) % m
        if ph or pw:
            x = F.pad(x, (0, pw, 0, ph), mode="reflect")
        skips = []
        for i, block in enumerate(self.down):
            if i:
                x = F.avg_pool2d(x, 2)
            x = block(x)
            skips.append(x)
        skips.pop()
        for up in self.up:
            x = up(x, skips.pop())
        return self.head(x)[..., :H, :W]


def n_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def build(config: dict | None = None) -> UNet:
    config = config or {}
    return UNet(widths=tuple(config.get("widths", WIDTHS)))


if __name__ == "__main__":
    net = UNet()
    print(f"{n_params(net) / 1e6:.2f} M parameters, widths {net.widths}")
    x = torch.randn(2, N_IN, 203, 317)
    y = net(x)
    print("in", tuple(x.shape), "out", tuple(y.shape))
